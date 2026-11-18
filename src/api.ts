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

/** The widest window any endpoint serves: the dashboard's "All time" (ten years). */
export const MAX_DAYS = 3650;

/**
 * Lines added / removed by one snapshot. Agent 0.3 sends true per-file line
 * diffs (`lines_added`/`lines_removed`); before that, and on a baseline
 * capture, only the net change in total lines exists, so a replaced line
 * reads as nothing. These fall back to the net figure where that is all there is.
 */
const ADDED = `COALESCE(lines_added, CASE WHEN lines_delta > 0 THEN lines_delta END)`;
const REMOVED = `COALESCE(lines_removed, CASE WHEN lines_delta < 0 THEN -lines_delta END)`;

/** `days` query param, clamped to 1..MAX_DAYS. */
function windowStart(c: { req: { query: (k: string) => string | undefined } }, fallback = 7): number {
  const days = Math.min(Math.max(Number(c.req.query('days') ?? fallback) || fallback, 1), MAX_DAYS);
  return Math.floor(Date.now() / 1000) - days * 86400;
}

/** The signed-in account's project by name; another account's is not found. */
async function projectId(env: Env, account: string, name: string): Promise<number | null> {
  const row = await env.DB.prepare(`SELECT id FROM projects WHERE account_id = ?1 AND name = ?2`)
    .bind(account, name)
    .first<{ id: number }>();
  return row?.id ?? null;
}

/** Columns describing the state at one snapshot, shared by the list and the timeline. */
const STATE_COLUMNS = `
  s.captured_at, s.received_at, s.file_count, s.total_lines, s.total_bytes, s.skipped_files,
  s.capture_ms, s.os, s.arch, s.agent_version, s.tree_hash,
  s.git_head, s.git_branch, s.git_dirty, s.git_ahead, s.git_behind,
  s.git_staged, s.git_modified, s.git_untracked, s.git_conflicted,
  s.git_insertions, s.git_deletions, s.git_commits, s.git_last_commit_at, s.git_stashes,
  s.seq, s.chain, s.build_at, s.test_at`;

/**
 * Every project with the state of its most recent snapshot, plus what
 * happened in the window (`days`): active time (the same session sum the
 * project page shows), lines written, saves, builds and chain breaks.
 */
api.get('/api/projects', async (c) => {
  const account = c.get('accountId');
  const gap = Number(c.env.SESSION_GAP_SECONDS) || 900;
  const from = windowStart(c);

  const [{ results }, { results: moves }, { results: windows }] = await Promise.all([
    c.env.DB.prepare(
      `SELECT p.name, ${STATE_COLUMNS}
         FROM projects p
         LEFT JOIN snapshots s ON s.id = (
           SELECT id FROM snapshots WHERE project_id = p.id ORDER BY captured_at DESC LIMIT 1
         )
        WHERE p.account_id = ?1
        ORDER BY s.captured_at DESC NULLS LAST`,
    )
      .bind(account)
      .all<{ name: string }>(),
    // Only the changed snapshots' times: enough to rebuild sessions per project.
    c.env.DB.prepare(
      `SELECT p.name, s.captured_at
         FROM snapshots s JOIN projects p ON p.id = s.project_id
        WHERE p.account_id = ?1 AND s.captured_at >= ?2 AND s.unchanged = 0
        ORDER BY s.project_id, s.captured_at ASC`,
    )
      .bind(account, from)
      .all<{ name: string; captured_at: number }>(),
    c.env.DB.prepare(
      `SELECT p.name,
              COUNT(*)                                                    AS snapshots,
              SUM(${ADDED})                                               AS lines_added,
              SUM(${REMOVED})                                             AS lines_removed,
              SUM(save_count)                                             AS saves,
              COUNT(DISTINCT build_at)                                    AS builds,
              COUNT(DISTINCT test_at)                                     AS tests,
              SUM(CASE WHEN chain IN ('gap','fork','restart') THEN 1 ELSE 0 END) AS chain_breaks
         FROM snapshots s JOIN projects p ON p.id = s.project_id
        WHERE p.account_id = ?1 AND s.captured_at >= ?2
        GROUP BY p.name`,
    )
      .bind(account, from)
      .all<{ name: string }>(),
  ]);

  const times = new Map<string, number[]>();
  for (const m of moves) {
    const list = times.get(m.name);
    if (list) list.push(m.captured_at);
    else times.set(m.name, [m.captured_at]);
  }
  const win = new Map(windows.map((w) => [w.name, w]));

  return c.json({
    projects: results.map((p) => {
      const w = win.get(p.name);
      return {
        ...p,
        active_seconds: activeSeconds(times.get(p.name) ?? [], gap),
        window: {
          snapshots: 0,
          lines_added: 0,
          lines_removed: 0,
          saves: 0,
          builds: 0,
          tests: 0,
          chain_breaks: 0,
          ...(w ? { ...w, name: undefined } : {}),
        },
      };
    }),
  });
});

/**
 * Total session length over ascending capture times of changed snapshots:
 * split wherever two are more than `gap` apart, each session counted from its
 * first change to its last. Equal to summing /sessions over the same window.
 */
function activeSeconds(times: number[], gap: number): number {
  if (times.length === 0) return 0;
  let total = 0;
  let start = times[0];
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] > gap) {
      total += times[i - 1] - start;
      start = times[i];
    }
  }
  return total + times[times.length - 1] - start;
}

/** Raw snapshot rows for charting. One row per tick; summary columns only. */
api.get('/api/projects/:name/timeline', async (c) => {
  const id = await projectId(c.env, c.get('accountId'), c.req.param('name'));
  if (id === null) return c.json({ error: 'unknown project' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT ${STATE_COLUMNS}, s.unchanged,
            s.files_added, s.files_removed, s.files_modified, s.lines_delta,
            s.lines_added, s.lines_removed, s.tail_edits, s.mid_edits, s.save_count, s.fp_files
       FROM snapshots s
      WHERE s.project_id = ?1 AND s.captured_at >= ?2
      ORDER BY s.captured_at ASC`,
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
    `SELECT captured_at, unchanged, ${ADDED} AS added, ${REMOVED} AS removed, save_count,
            files_added, files_removed, files_modified
       FROM snapshots
      WHERE project_id = ?1 AND captured_at >= ?2
      ORDER BY captured_at ASC`,
  )
    .bind(id, windowStart(c, 30))
    .all<{
      captured_at: number;
      unchanged: number;
      added: number | null;
      removed: number | null;
      save_count: number | null;
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
    saves: number;
  }

  const sessions: Session[] = [];
  let pendingSaves = 0;
  for (const row of results) {
    // Saves recorded on an unchanged tick belong to whichever session they fall
    // in, but an unchanged tick alone does not start or extend one.
    if (row.unchanged) {
      const last = sessions[sessions.length - 1];
      if (last && row.captured_at - last.ended_at <= gap) last.saves += row.save_count ?? 0;
      else pendingSaves += row.save_count ?? 0;
      continue;
    }
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
            saves: pendingSaves,
          }),
          sessions[sessions.length - 1]);
    pendingSaves = 0;

    cur.ended_at = row.captured_at;
    cur.seconds = cur.ended_at - cur.started_at;
    cur.ticks++;
    cur.lines_added += row.added ?? 0;
    cur.lines_removed += row.removed ?? 0;
    cur.saves += row.save_count ?? 0;
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
            SUM(${ADDED})                                        AS lines_added,
            SUM(${REMOVED})                                      AS lines_removed,
            SUM(lines_added)                                     AS exact_added,
            SUM(tail_edits)                                      AS tail_edits,
            SUM(mid_edits)                                       AS mid_edits,
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
            SUM(save_count)                                      AS saves,
            COUNT(DISTINCT build_at)                             AS builds,
            COUNT(DISTINCT test_at)                              AS tests,
            MAX(build_at)                                        AS last_build_at,
            MAX(test_at)                                         AS last_test_at,
            SUM(fp_files)                                        AS fingerprinted_files,
            AVG(capture_ms)                                      AS avg_capture_ms,
            MAX(capture_ms)                                      AS max_capture_ms,
            MAX(git_commits) - MIN(git_commits)                  AS commits_made,
            COUNT(seq)                                           AS chained,
            SUM(CASE WHEN chain = 'gap' THEN 1 ELSE 0 END)       AS chain_gaps,
            SUM(CASE WHEN chain = 'fork' THEN 1 ELSE 0 END)      AS chain_forks,
            SUM(CASE WHEN chain = 'restart' THEN 1 ELSE 0 END)   AS chain_restarts,
            MIN(captured_at)                                     AS first_seen,
            MAX(captured_at)                                     AS last_seen
       FROM snapshots
      WHERE project_id = ?1 AND captured_at >= ?2`,
  )
    .bind(id, from, LAG_THRESHOLD_SECONDS)
    .first();

  // Days are cut in the viewer's timezone (`tz`), so they line up with the
  // Hackatime daily totals, which are bucketed the same way.
  const shift = `${tzOffsetMinutes(c)} minutes`;
  const [{ results: daily }, { results: breaks }] = await Promise.all([
    c.env.DB.prepare(
      `SELECT strftime('%Y-%m-%d', captured_at, 'unixepoch', ?3)   AS day,
              SUM(CASE WHEN unchanged = 0 THEN 1 ELSE 0 END)       AS active_ticks,
              SUM(${ADDED})                                        AS lines_added,
              SUM(${REMOVED})                                      AS lines_removed,
              SUM(save_count)                                      AS saves
         FROM snapshots
        WHERE project_id = ?1 AND captured_at >= ?2
        GROUP BY day ORDER BY day ASC`,
    )
      .bind(id, from, shift)
      .all(),
    // The snapshots where the chain broke, newest first, so the page can say when.
    c.env.DB.prepare(
      `SELECT captured_at, seq, chain FROM snapshots
        WHERE project_id = ?1 AND captured_at >= ?2 AND chain IN ('gap','fork','restart')
        ORDER BY captured_at DESC LIMIT 20`,
    )
      .bind(id, from)
      .all(),
  ]);

  return c.json({ totals, daily, breaks, lag_threshold_seconds: LAG_THRESHOLD_SECONDS });
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
            SUM(COALESCE(${ADDED}, 0) + COALESCE(${REMOVED}, 0))         AS lines_moved
       FROM snapshots
      WHERE project_id = ?1 AND captured_at >= ?2 AND unchanged = 0
      GROUP BY dow, hour`,
  )
    .bind(id, windowStart(c), shift)
    .all();

  return c.json({ cells: results });
});

/**
 * Saves per local hour of day, from the save times agent 0.3 records between
 * captures. Finer than snapshots: a 5-minute interval still shows each save.
 */
api.get('/api/projects/:name/saves', async (c) => {
  const id = await projectId(c.env, c.get('accountId'), c.req.param('name'));
  if (id === null) return c.json({ error: 'unknown project' }, 404);
  const from = windowStart(c);
  const shift = tzOffsetMinutes(c) * 60;

  const { results } = await c.env.DB.prepare(
    `SELECT save_times FROM snapshots
      WHERE project_id = ?1 AND captured_at >= ?2 AND save_times IS NOT NULL
      ORDER BY captured_at ASC LIMIT 5000`,
  )
    .bind(id, from)
    .all<{ save_times: string }>();

  const hours = new Array<number>(24).fill(0);
  let total = 0;
  let longestGap = 0;
  let last: number | null = null;
  for (const r of results) {
    let times: number[];
    try {
      times = JSON.parse(r.save_times) as number[];
    } catch {
      continue;
    }
    for (const t of times) {
      if (t < from) continue;
      hours[Math.floor((((t + shift) % 86400) + 86400) % 86400 / 3600)]++;
      total++;
      if (last !== null && t - last < 3600) longestGap = Math.max(longestGap, t - last);
      last = t;
    }
  }

  return c.json({ hours, total, longest_gap_in_session: longestGap });
});

/**
 * Work grouped by the commit that was HEAD while it happened.
 *
 * Grouping on git.head turns the timeline into "what you did on top of each
 * commit": the span is how long that commit stayed HEAD, the deltas are the
 * work done during it.
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
            SUM(${ADDED})                                        AS lines_added,
            SUM(${REMOVED})                                      AS lines_removed,
            SUM(COALESCE(files_added,0) + COALESCE(files_removed,0)
                + COALESCE(files_modified,0))                    AS files_touched,
            SUM(save_count)                                      AS saves,
            MAX(git_last_commit_at)                              AS committed_at,
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
 * absorbed 60% of your churn" is still real signal, and `snapshot-agent
 * reveal` maps a hash back to a name on the machine that made it.
 *
 * Agent 0.3 sends true per-file line diffs, stored in file_edits, so this is
 * an aggregate: lines added and removed, and whether they landed at the end
 * of the file (tail) or inside it (mid). For windows with only older data it
 * falls back to walking stored file lists and ranking by |net line change|,
 * capped at 200 distinct trees.
 */
api.get('/api/projects/:name/churn', async (c) => {
  const id = await projectId(c.env, c.get('accountId'), c.req.param('name'));
  if (id === null) return c.json({ error: 'unknown project' }, 404);
  const from = windowStart(c);

  const { results: edits } = await c.env.DB.prepare(
    `SELECT path_hash,
            COUNT(*)              AS revisions,
            SUM(added + removed)  AS lines_moved,
            SUM(added)            AS added,
            SUM(removed)          AS removed,
            SUM(tail)             AS tail,
            SUM(mid)              AS mid,
            lines,
            MAX(captured_at)      AS last_edit
       FROM file_edits
      WHERE project_id = ?1 AND captured_at >= ?2
      GROUP BY path_hash
      ORDER BY lines_moved DESC, revisions DESC
      LIMIT 25`,
  )
    .bind(id, from)
    .all();
  if (edits.length > 0) return c.json({ files: edits, source: 'edits', trees_compared: 0 });

  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT s.tree_hash
       FROM snapshots s JOIN trees t ON t.account_id = ?3 AND t.tree_hash = s.tree_hash
      WHERE s.project_id = ?1 AND s.captured_at >= ?2 AND t.files_blob IS NOT NULL
      ORDER BY s.captured_at ASC LIMIT 200`,
  )
    .bind(id, from, c.get('accountId'))
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
    .sort((a, b) => b[1].lines_moved - a[1].lines_moved || b[1].revisions - a[1].revisions)
    .slice(0, 25)
    .map(([path_hash, v]) => ({ path_hash, ...v }));

  return c.json({ files: top, source: 'trees', trees_compared: results.length });
});

/** Rows of file_prints read at most per overlap request. */
const MAX_PRINT_ROWS = 20_000;
/** One shared 30-token run can be boilerplate; two is a pattern. */
const MIN_SHARED = 2;

/**
 * Copy detection. Agent 0.3 sends winnowed fingerprints of each changed file;
 * the latest set per file is kept. This lists files in the project that share
 * fingerprints with another file — in another project of this account, or a
 * different file in the same project — ranked by how much of the file is shared.
 *
 * Everything is scoped to the account: fingerprints are never compared across
 * users.
 */
api.get('/api/projects/:name/overlap', async (c) => {
  const account = c.get('accountId');
  const id = await projectId(c.env, account, c.req.param('name'));
  if (id === null) return c.json({ error: 'unknown project' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT f.project_id, p.name AS project, f.path_hash, f.fps, f.lines
       FROM file_prints f JOIN projects p ON p.id = f.project_id
      WHERE f.account_id = ?1
      ORDER BY f.updated_at DESC LIMIT ?2`,
  )
    .bind(account, MAX_PRINT_ROWS)
    .all<{ project_id: number; project: string; path_hash: string; fps: string; lines: number }>();

  interface Doc {
    project: string;
    path_hash: string;
    fps: Set<number>;
    lines: number;
  }
  const mine: Doc[] = [];
  const index = new Map<number, Doc[]>();
  for (const r of results) {
    let fps: number[];
    try {
      fps = JSON.parse(r.fps) as number[];
    } catch {
      continue;
    }
    const doc: Doc = { project: r.project, path_hash: r.path_hash, fps: new Set(fps), lines: r.lines };
    if (r.project_id === id) mine.push(doc);
    for (const fp of doc.fps) {
      const list = index.get(fp);
      if (list) list.push(doc);
      else index.set(fp, [doc]);
    }
  }

  const pairs: {
    path_hash: string;
    lines: number;
    prints: number;
    other_project: string;
    other_path_hash: string;
    other_lines: number;
    shared: number;
  }[] = [];
  for (const doc of mine) {
    const hits = new Map<Doc, number>();
    for (const fp of doc.fps) {
      for (const other of index.get(fp) ?? []) {
        if (other === doc) continue;
        hits.set(other, (hits.get(other) ?? 0) + 1);
      }
    }
    for (const [other, shared] of hits) {
      if (shared < MIN_SHARED) continue;
      // A pair inside this project is listed once, not from both ends.
      if (other.project === doc.project && other.path_hash < doc.path_hash) continue;
      pairs.push({
        path_hash: doc.path_hash,
        lines: doc.lines,
        prints: doc.fps.size,
        other_project: other.project,
        other_path_hash: other.path_hash,
        other_lines: other.lines,
        shared,
      });
    }
  }
  pairs.sort((a, b) => b.shared / b.prints - a.shared / a.prints || b.shared - a.shared);

  return c.json({
    pairs: pairs.slice(0, 50),
    files_fingerprinted: mine.length,
    files_compared: results.length,
  });
});

/**
 * The machines running the agent for this account: one row per OS, arch and
 * agent version, with the projects they report and when they were last heard.
 */
api.get('/api/agents', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.os, s.arch, s.agent_version,
            COUNT(DISTINCT s.project_id) AS projects,
            COUNT(*)                     AS snapshots,
            MAX(s.received_at)           AS last_seen,
            AVG(s.capture_ms)            AS avg_capture_ms
       FROM snapshots s JOIN projects p ON p.id = s.project_id
      WHERE p.account_id = ?1 AND s.received_at >= ?2
      GROUP BY s.os, s.arch, s.agent_version
      ORDER BY last_seen DESC`,
  )
    .bind(c.get('accountId'), windowStart(c, 30))
    .all();
  return c.json({ agents: results });
});
