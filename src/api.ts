import { Hono } from 'hono';
import type { Env } from './types';
import { requireDashboard } from './auth';
import { getTree } from './trees';

type Ctx = { Bindings: Env };

const ACCOUNT = 'local'; // single-user build

export const api = new Hono<Ctx>();

api.use('/api/*', requireDashboard);

/** `days` query param, clamped to something a dashboard can actually plot. */
function windowStart(c: { req: { query: (k: string) => string | undefined } }, fallback = 7): number {
  const days = Math.min(Math.max(Number(c.req.query('days') ?? fallback) || fallback, 1), 365);
  return Math.floor(Date.now() / 1000) - days * 86400;
}

async function projectId(env: Env, name: string): Promise<number | null> {
  const row = await env.DB.prepare(`SELECT id FROM projects WHERE account_id = ?1 AND name = ?2`)
    .bind(ACCOUNT, name)
    .first<{ id: number }>();
  return row?.id ?? null;
}

/** Every project with the state of its most recent snapshot. */
api.get('/api/projects', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.name,
            s.captured_at, s.file_count, s.total_lines, s.tree_hash,
            s.git_branch, s.git_dirty, s.git_ahead, s.agent_version
       FROM projects p
       LEFT JOIN snapshots s ON s.id = (
         SELECT id FROM snapshots WHERE project_id = p.id ORDER BY captured_at DESC LIMIT 1
       )
      WHERE p.account_id = ?1
      ORDER BY s.captured_at DESC NULLS LAST`,
  )
    .bind(ACCOUNT)
    .all();

  return c.json({ projects: results });
});

/** Raw snapshot rows for charting. One row per tick; no R2 reads. */
api.get('/api/projects/:name/timeline', async (c) => {
  const id = await projectId(c.env, c.req.param('name'));
  if (id === null) return c.json({ error: 'unknown project' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT captured_at, file_count, total_lines, unchanged,
            files_added, files_removed, files_modified, lines_delta,
            git_branch, git_dirty, git_ahead
       FROM snapshots
      WHERE project_id = ?1 AND captured_at >= ?2
      ORDER BY captured_at ASC`,
  )
    .bind(id, windowStart(c))
    .all();

  return c.json({ snapshots: results });
});

/**
 * Coding sessions: runs of snapshots whose tree actually moved, split wherever
 * the gap between captures exceeds SESSION_GAP_SECONDS. This is the
 * "you worked 2h14m today" number, derived from tree movement rather than from
 * an editor plugin.
 */
api.get('/api/projects/:name/sessions', async (c) => {
  const id = await projectId(c.env, c.req.param('name'));
  if (id === null) return c.json({ error: 'unknown project' }, 404);

  const gap = Number(c.env.SESSION_GAP_SECONDS) || 900;
  const { results } = await c.env.DB.prepare(
    `SELECT captured_at, lines_delta, files_added, files_removed, files_modified
       FROM snapshots
      WHERE project_id = ?1 AND captured_at >= ?2 AND unchanged = 0
      ORDER BY captured_at ASC`,
  )
    .bind(id, windowStart(c, 30))
    .all<{
      captured_at: number;
      lines_delta: number | null;
      files_added: number | null;
      files_removed: number | null;
      files_modified: number | null;
    }>();

  interface Session {
    started_at: number;
    ended_at: number;
    seconds: number;
    ticks: number;
    lines_added: number;
    lines_removed: number;
    files_touched: number;
  }

  const sessions: Session[] = [];
  for (const row of results) {
    const last = sessions[sessions.length - 1];
    const cur =
      last && row.captured_at - last.ended_at <= gap
        ? last
        : (sessions.push({
            started_at: row.captured_at,
            ended_at: row.captured_at,
            seconds: 0,
            ticks: 0,
            lines_added: 0,
            lines_removed: 0,
            files_touched: 0,
          }),
          sessions[sessions.length - 1]);

    cur.ended_at = row.captured_at;
    cur.seconds = cur.ended_at - cur.started_at;
    cur.ticks++;
    const delta = row.lines_delta ?? 0;
    if (delta > 0) cur.lines_added += delta;
    else cur.lines_removed += -delta;
    cur.files_touched +=
      (row.files_added ?? 0) + (row.files_removed ?? 0) + (row.files_modified ?? 0);
  }

  return c.json({ sessions: sessions.reverse(), gap_seconds: gap });
});

/** Headline counters for the window, plus a per-day activity roll-up. */
api.get('/api/projects/:name/summary', async (c) => {
  const id = await projectId(c.env, c.req.param('name'));
  if (id === null) return c.json({ error: 'unknown project' }, 404);
  const from = windowStart(c);

  const totals = await c.env.DB.prepare(
    `SELECT COUNT(*)                                             AS ticks,
            SUM(CASE WHEN unchanged = 0 THEN 1 ELSE 0 END)       AS active_ticks,
            SUM(CASE WHEN lines_delta > 0 THEN lines_delta END)  AS lines_added,
            SUM(CASE WHEN lines_delta < 0 THEN -lines_delta END) AS lines_removed,
            SUM(COALESCE(files_added,0) + COALESCE(files_removed,0)
                + COALESCE(files_modified,0))                    AS files_touched
       FROM snapshots
      WHERE project_id = ?1 AND captured_at >= ?2`,
  )
    .bind(id, from)
    .first();

  // strftime on a unix column gives UTC days. Good enough for a roll-up; swap
  // to a stored local-day column if the heatmap ever needs the user's timezone.
  const { results: daily } = await c.env.DB.prepare(
    `SELECT strftime('%Y-%m-%d', captured_at, 'unixepoch')       AS day,
            SUM(CASE WHEN unchanged = 0 THEN 1 ELSE 0 END)       AS active_ticks,
            SUM(CASE WHEN lines_delta > 0 THEN lines_delta END)  AS lines_added,
            SUM(CASE WHEN lines_delta < 0 THEN -lines_delta END) AS lines_removed
       FROM snapshots
      WHERE project_id = ?1 AND captured_at >= ?2
      GROUP BY day ORDER BY day ASC`,
  )
    .bind(id, from)
    .all();

  return c.json({ totals, daily });
});

/**
 * Per-file churn ranking. Paths are hashes and always will be, but "one file
 * absorbed 60% of your churn" is still real signal, and the hashes can be
 * mapped back locally by whoever runs the agent.
 *
 * This is the one endpoint that reads R2, so it is deliberately narrow: it
 * walks distinct trees in the window rather than every tick.
 */
api.get('/api/projects/:name/churn', async (c) => {
  const id = await projectId(c.env, c.req.param('name'));
  if (id === null) return c.json({ error: 'unknown project' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT s.tree_hash
       FROM snapshots s JOIN trees t ON t.tree_hash = s.tree_hash
      WHERE s.project_id = ?1 AND s.captured_at >= ?2 AND t.files_key IS NOT NULL
      ORDER BY s.captured_at ASC LIMIT 200`,
  )
    .bind(id, windowStart(c))
    .all<{ tree_hash: string }>();

  const changes = new Map<string, number>();
  let previous: Map<string, string> | null = null;

  for (const { tree_hash } of results) {
    const files = await getTree(c.env, tree_hash);
    if (!files) continue;
    const current = new Map(files.map((f) => [f.path_hash, f.content_hash]));
    if (previous) {
      for (const [path, content] of current) {
        const before = previous.get(path);
        if (before !== undefined && before !== content) {
          changes.set(path, (changes.get(path) ?? 0) + 1);
        }
      }
    }
    previous = current;
  }

  const top = [...changes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([path_hash, revisions]) => ({ path_hash, revisions }));

  return c.json({ files: top, trees_compared: results.length });
});
