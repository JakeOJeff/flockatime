import { Hono } from 'hono';
import type { AppEnv, Env, WireFile } from './types';
import { requireDashboard } from './auth';
import { getTree } from './trees';

/**
 * A snapshot that reached the server this long after it was captured did not
 * arrive live — it sat in the offline queue. Normal ingest is sub-second, so
 * anything past a couple of minutes is a flush rather than jitter.
 */
const LAG_THRESHOLD_SECONDS = 120;

export const api = new Hono<AppEnv>();

api.use('/api/*', requireDashboard);

/** `days` query param, clamped to something a dashboard can actually plot. */
function windowStart(c: { req: { query: (k: string) => string | undefined } }, fallback = 7): number {
  const days = Math.min(Math.max(Number(c.req.query('days') ?? fallback) || fallback, 1), 365);
  return Math.floor(Date.now() / 1000) - days * 86400;
}

/** The signed-in account's project by name; another account's is not found. */
async function projectId(env: Env, account: string, name: string): Promise<number | null> {
  const row = await env.DB.prepare(`SELECT id FROM projects WHERE account_id = ?1 AND name = ?2`)
    .bind(account, name)
    .first<{ id: number }>();
  return row?.id ?? null;
}

/** Every project with the state of its most recent snapshot. */
api.get('/api/projects', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.name,
            s.captured_at, s.received_at, s.file_count, s.total_lines, s.tree_hash,
            s.git_head, s.git_branch, s.git_dirty, s.git_ahead, s.agent_version
       FROM projects p
       LEFT JOIN snapshots s ON s.id = (
         SELECT id FROM snapshots WHERE project_id = p.id ORDER BY captured_at DESC LIMIT 1
       )
      WHERE p.account_id = ?1
      ORDER BY s.captured_at DESC NULLS LAST`,
  )
    .bind(c.get('accountId'))
    .all();

  return c.json({ projects: results });
});

/** Raw snapshot rows for charting. One row per tick; summary columns only. */
api.get('/api/projects/:name/timeline', async (c) => {
  const id = await projectId(c.env, c.get('accountId'), c.req.param('name'));
  if (id === null) return c.json({ error: 'unknown project' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT captured_at, received_at, file_count, total_lines, unchanged,
            files_added, files_removed, files_modified, lines_delta,
            git_head, git_branch, git_dirty, git_ahead
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
  const id = await projectId(c.env, c.get('accountId'), c.req.param('name'));
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
  const id = await projectId(c.env, c.get('accountId'), c.req.param('name'));
  if (id === null) return c.json({ error: 'unknown project' }, 404);
  const from = windowStart(c);

  // received_at is the server clock and the only trustworthy one here. The
  // charts are still plotted on captured_at, which is what the agent believed,
  // so the spread between the two is reported rather than silently absorbed.
  const totals = await c.env.DB.prepare(
    `SELECT COUNT(*)                                             AS ticks,
            SUM(CASE WHEN unchanged = 0 THEN 1 ELSE 0 END)       AS active_ticks,
            SUM(CASE WHEN lines_delta > 0 THEN lines_delta END)  AS lines_added,
            SUM(CASE WHEN lines_delta < 0 THEN -lines_delta END) AS lines_removed,
            SUM(COALESCE(files_added,0) + COALESCE(files_removed,0)
                + COALESCE(files_modified,0))                    AS files_touched,
            SUM(CASE WHEN received_at - captured_at > ?3
                     THEN 1 ELSE 0 END)                          AS delayed_ticks,
            MAX(received_at - captured_at)                       AS max_lag_seconds,
            SUM(files_added)                                     AS files_added,
            SUM(files_removed)                                   AS files_removed,
            SUM(files_modified)                                  AS files_modified,
            COUNT(DISTINCT git_head)                             AS commits,
            COUNT(DISTINCT git_branch)                           AS branches,
            MIN(captured_at)                                     AS first_seen,
            MAX(captured_at)                                     AS last_seen
       FROM snapshots
      WHERE project_id = ?1 AND captured_at >= ?2`,
  )
    .bind(id, from, LAG_THRESHOLD_SECONDS)
    .first();

  // Days are cut in the viewer's timezone (`tz`), so they line up with the
  // Hackatime daily totals, which are bucketed the same way.
  const { results: daily } = await c.env.DB.prepare(
    `SELECT strftime('%Y-%m-%d', captured_at, 'unixepoch', ?3)   AS day,
            SUM(CASE WHEN unchanged = 0 THEN 1 ELSE 0 END)       AS active_ticks,
            SUM(CASE WHEN lines_delta > 0 THEN lines_delta END)  AS lines_added,
            SUM(CASE WHEN lines_delta < 0 THEN -lines_delta END) AS lines_removed
       FROM snapshots
      WHERE project_id = ?1 AND captured_at >= ?2
      GROUP BY day ORDER BY day ASC`,
  )
    .bind(id, from, `${tzOffsetMinutes(c)} minutes`)
    .all();

  return c.json({ totals, daily, lag_threshold_seconds: LAG_THRESHOLD_SECONDS });
});

/**
 * The viewer's UTC offset in minutes (`tz`, as -Date#getTimezoneOffset()), as an
 * SQLite date modifier. Clamped to real offsets so it is safe to interpolate.
 */
export function tzOffsetMinutes(c: { req: { query: (k: string) => string | undefined } }): number {
  const tz = Math.trunc(Number(c.req.query('tz') ?? 0)) || 0;
  return Math.min(Math.max(tz, -840), 840);
}

/**
 * When in the week the tree moves: active ticks and lines moved per weekday ×
 * hour, in the viewer's timezone so "9pm" means their 9pm.
 */
api.get('/api/projects/:name/rhythm', async (c) => {
  const id = await projectId(c.env, c.get('accountId'), c.req.param('name'));
  if (id === null) return c.json({ error: 'unknown project' }, 404);
  const shift = `${tzOffsetMinutes(c)} minutes`;

  const { results } = await c.env.DB.prepare(
    `SELECT CAST(strftime('%w', captured_at, 'unixepoch', ?3) AS INTEGER) AS dow,
            CAST(strftime('%H', captured_at, 'unixepoch', ?3) AS INTEGER) AS hour,
            COUNT(*)                                                     AS active_ticks,
            SUM(ABS(COALESCE(lines_delta, 0)))                           AS lines_moved
       FROM snapshots
      WHERE project_id = ?1 AND captured_at >= ?2 AND unchanged = 0
      GROUP BY dow, hour`,
  )
    .bind(id, windowStart(c), shift)
    .all();

  return c.json({ cells: results });
});

/**
 * Work grouped by the commit that was HEAD while it happened.
 *
 * The agent has always sent git.head on every snapshot and nothing ever read it
 * back, so the one column linking a tree to a commit sat unused. Grouping on it
 * turns the timeline into "what you did on top of each commit": the span is how
 * long that commit stayed HEAD, the deltas are the work done during it.
 */
api.get('/api/projects/:name/commits', async (c) => {
  const id = await projectId(c.env, c.get('accountId'), c.req.param('name'));
  if (id === null) return c.json({ error: 'unknown project' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT git_head,
            MAX(git_branch)                                      AS git_branch,
            MIN(captured_at)                                     AS first_seen,
            MAX(captured_at)                                     AS last_seen,
            MAX(captured_at) - MIN(captured_at)                  AS seconds,
            COUNT(*)                                             AS ticks,
            SUM(CASE WHEN unchanged = 0 THEN 1 ELSE 0 END)       AS active_ticks,
            SUM(CASE WHEN lines_delta > 0 THEN lines_delta END)  AS lines_added,
            SUM(CASE WHEN lines_delta < 0 THEN -lines_delta END) AS lines_removed,
            SUM(COALESCE(files_added,0) + COALESCE(files_removed,0)
                + COALESCE(files_modified,0))                    AS files_touched,
            MAX(git_dirty)                                       AS ever_dirty
       FROM snapshots
      WHERE project_id = ?1 AND captured_at >= ?2 AND git_head IS NOT NULL
      GROUP BY git_head
      ORDER BY last_seen DESC
      LIMIT 50`,
  )
    .bind(id, windowStart(c))
    .all();

  return c.json({ commits: results });
});

/**
 * Per-file churn ranking. Paths are hashes and always will be, but "one file
 * absorbed 60% of your churn" is still real signal, and the hashes can be
 * mapped back locally by whoever runs the agent.
 *
 * The agent sends a line count on every file record. Ranking on revision count
 * alone discarded it and scored a typo the same as a rewrite, so the ordering
 * is by lines moved now, with the revision count kept alongside.
 *
 * `lines_moved` sums |net line change| across revisions, so an edit that
 * replaces a line without changing the count reads as 0. True diff-line churn
 * would need line-level hashes the agent does not send; this is the weaker
 * number that the wire format actually supports.
 *
 * This is the one endpoint that reads stored file lists back, so it is
 * deliberately narrow: it walks distinct trees in the window rather than every
 * tick, capped at 200.
 */
api.get('/api/projects/:name/churn', async (c) => {
  const id = await projectId(c.env, c.get('accountId'), c.req.param('name'));
  if (id === null) return c.json({ error: 'unknown project' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT s.tree_hash
       FROM snapshots s JOIN trees t ON t.account_id = ?3 AND t.tree_hash = s.tree_hash
      WHERE s.project_id = ?1 AND s.captured_at >= ?2 AND t.files_blob IS NOT NULL
      ORDER BY s.captured_at ASC LIMIT 200`,
  )
    .bind(id, windowStart(c), c.get('accountId'))
    .all<{ tree_hash: string }>();

  interface Churn {
    revisions: number;
    lines_moved: number;
    lines: number;
  }

  const state = (f: WireFile) => ({ content: f.content_hash, lines: f.lines ?? 0 });

  const changes = new Map<string, Churn>();
  let previous: Map<string, ReturnType<typeof state>> | null = null;

  for (const { tree_hash } of results) {
    const files = await getTree(c.env, c.get('accountId'), tree_hash);
    if (!files) continue;
    const current = new Map(files.map((f) => [f.path_hash, state(f)]));
    if (previous) {
      for (const [path, now] of current) {
        const before = previous.get(path);
        if (before !== undefined && before.content !== now.content) {
          const entry = changes.get(path) ?? { revisions: 0, lines_moved: 0, lines: 0 };
          entry.revisions++;
          entry.lines_moved += Math.abs(now.lines - before.lines);
          entry.lines = now.lines; // the most recent size wins
          changes.set(path, entry);
        }
      }
    }
    previous = current;
  }

  const top = [...changes.entries()]
    // Lines first, revisions as the tie-break: a file rewritten once outranks
    // one saved twenty times without ever growing.
    .sort((a, b) => b[1].lines_moved - a[1].lines_moved || b[1].revisions - a[1].revisions)
    .slice(0, 25)
    .map(([path_hash, v]) => ({ path_hash, ...v }));

  return c.json({ files: top, trees_compared: results.length });
});
