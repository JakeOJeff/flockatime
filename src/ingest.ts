import { Hono } from 'hono';
import type { AppEnv, FileEdit, FilePrints, WireFile, WireGit, WireSnapshot } from './types';
import { requireAgentKey } from './auth';
import { diffTrees, getTree, packTree } from './trees';

const MAX_BATCH = 5000; // the agent caps its own queue here
const PARAM_CHUNK = 40; // keep bound-parameter counts per statement small

const isHex = (v: unknown, len: number) =>
  typeof v === 'string' && v.length === len && /^[0-9a-f]+$/.test(v);

/** Past this a file list is not stored; the snapshot's summary still is. */
const MAX_FILES = 100_000;
/** Under D1's 2 MB limit on one value, with room to spare. */
const MAX_BLOB_BYTES = 1_900_000;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length <= max ? v : null;

const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
};
/** A count the agent omits when zero. */
const count = (v: unknown): number => Math.max(0, int(v) ?? 0);

/** The agent masks fingerprints to 53 bits so they survive JSON in JavaScript. */
const MAX_FP = 2 ** 53 - 1;
/** The agent sends at most 50; a little slack for future agents. */
const MAX_FP_PER_FILE = 64;

function fingerprints(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: number[] = [];
  for (const x of v.slice(0, MAX_FP_PER_FILE)) {
    if (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= MAX_FP) out.push(x);
  }
  return out.length > 0 ? out : null;
}

interface ParsedFiles {
  files: WireFile[];
  edits: FileEdit[];
  prints: FilePrints[];
}

/** A file list with every record well-formed, or null. One bad record drops the list, never half of it. */
function normalizeFiles(v: unknown): ParsedFiles | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_FILES) return null;
  const out: ParsedFiles = { files: [], edits: [], prints: [] };
  for (const f of v) {
    if (typeof f !== 'object' || f === null) return null;
    const o = f as Record<string, unknown>;
    const path_hash = str(o.path_hash, 128);
    const content_hash = str(o.content_hash, 128);
    if (!path_hash || !content_hash) return null;
    const lines = num(o.lines) ?? 0;
    // Only the known fields are kept, so whatever else an agent sends is never stored.
    out.files.push({ path_hash, content_hash, lines, bytes: num(o.bytes) ?? 0, mtime: num(o.mtime) ?? 0 });

    const added = count(o.added);
    const removed = count(o.removed);
    if (added + removed > 0) {
      out.edits.push({ path_hash, added, removed, tail: count(o.tail), mid: count(o.mid), lines });
    }
    const fps = fingerprints(o.fp);
    if (fps) out.prints.push({ path_hash, fps, lines });
  }
  return out;
}

function normalizeGit(v: unknown): WireGit | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const g = v as Record<string, unknown>;
  return {
    head: str(g.head, 128) ?? '',
    branch: str(g.branch, 255) ?? '',
    dirty: g.dirty === true,
    ahead: int(g.ahead) ?? 0,
    behind: int(g.behind),
    staged: int(g.staged),
    modified: int(g.modified),
    untracked: int(g.untracked),
    conflicted: int(g.conflicted),
    insertions: int(g.insertions),
    deletions: int(g.deletions),
    commits: int(g.commits),
    last_commit_at: int(g.last_commit_at),
    stashes: int(g.stashes),
  };
}

/** Save offsets: non-negative seconds, capped so one record cannot bloat a row. */
function saveOffsets(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const out = v
    .slice(0, 2000)
    .filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0)
    .map(Math.trunc);
  return out;
}

/**
 * A malformed record is dropped, not rejected, and whatever is kept is
 * rebuilt from checked fields. Any non-2xx makes the agent re-queue the whole
 * batch, so a 400 — or a 500 from binding a stray object into D1 — would wedge
 * that agent into retrying it forever.
 */
function normalize(s: unknown): WireSnapshot | null {
  if (typeof s !== 'object' || s === null) return null;
  const o = s as Record<string, unknown>;
  const project = str(o.project, 128);
  const captured_at = num(o.captured_at);
  const file_count = num(o.file_count);
  const total_lines = num(o.total_lines);
  if (!project || captured_at === null || file_count === null || total_lines === null) return null;
  if (!isHex(o.tree_hash, 64)) return null;

  const parsed = normalizeFiles(o.files);
  const seq = int(o.seq);

  return {
    project,
    captured_at,
    tree_hash: o.tree_hash as string,
    file_count,
    total_lines,
    total_bytes: int(o.total_bytes),
    skipped_files: int(o.skipped_files),
    capture_ms: int(o.capture_ms),
    os: str(o.os, 32),
    arch: str(o.arch, 32),
    git: normalizeGit(o.git),
    files: parsed?.files,
    edits: parsed?.edits ?? [],
    prints: parsed?.prints ?? [],
    unchanged: o.unchanged === true,
    agent_version: str(o.agent_version, 64) ?? '',
    seq: seq !== null && seq > 0 ? seq : null,
    prev: isHex(o.prev, 64) ? (o.prev as string) : null,
    saves: saveOffsets(o.saves),
    build_at: int(o.build_at),
    test_at: int(o.test_at),
  };
}

/** Latest state we know for a project, carried forward as the batch is walked. */
interface Prev {
  tree_hash: string;
  total_lines: number;
  captured_at: number;
  seq: number | null;
  files: WireFile[] | null | undefined; // undefined = not loaded yet
}

export type Chain = 'ok' | 'start' | 'restart' | 'gap' | 'fork';

/**
 * What seq/prev say about this snapshot against the stored one before it.
 * Null when the agent sends no chain (before 0.3).
 */
export function chainStatus(s: { seq: number | null; prev: string | null }, p: Prev | null): Chain | null {
  if (s.seq === null) return null;
  if (!p || p.seq === null) return 'start';
  if (s.seq === 1) return 'restart';
  if (s.seq === p.seq + 1) return s.prev === p.tree_hash ? 'ok' : 'fork';
  return s.seq > p.seq + 1 ? 'gap' : 'fork';
}

export const ingest = new Hono<AppEnv>();

// `doctor` probes with GET and only needs an HTTP answer.
ingest.get('/v1/snapshots', (c) => c.json({ ok: true, service: 'flockatime' }));

ingest.post('/v1/snapshots', requireAgentKey, async (c) => {
  const accountId = c.get('accountId');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }

  // The agent always sends an array; tolerate a bare object anyway.
  const raw = Array.isArray(body) ? body : [body];
  if (raw.length > MAX_BATCH) return c.json({ error: 'batch too large' }, 413);

  const batch = raw
    .map(normalize)
    .filter((s): s is WireSnapshot => s !== null)
    .sort((a, b) => a.captured_at - b.captured_at);
  const skipped = raw.length - batch.length;
  if (batch.length === 0) return c.json({ accepted: 0, skipped }, 202);

  const db = c.env.DB;
  const now = Math.floor(Date.now() / 1000);

  // --- projects -----------------------------------------------------------
  const names = [...new Set(batch.map((s) => s.project))];
  await db.batch(
    names.map((n) =>
      db
        .prepare(`INSERT OR IGNORE INTO projects (account_id, name, created_at) VALUES (?1, ?2, ?3)`)
        .bind(accountId, n, now),
    ),
  );

  const projectIds = new Map<string, number>();
  for (const chunk of chunks(names, PARAM_CHUNK)) {
    const rows = await db
      .prepare(
        `SELECT id, name FROM projects
         WHERE account_id = ?1 AND name IN (${placeholders(chunk.length, 2)})`,
      )
      .bind(accountId, ...chunk)
      .all<{ id: number; name: string }>();
    for (const r of rows.results) projectIds.set(r.name, r.id);
  }

  // --- store new trees ----------------------------------------------------
  // Deduped by hash within the account: the hash is derived from the list, so
  // a hash this account already stored is a list it already wrote. Never
  // across accounts, or one account's upload would answer for another's.
  const withFiles = new Map<string, WireSnapshot>();
  for (const s of batch) {
    if (s.files && s.files.length > 0 && !withFiles.has(s.tree_hash)) {
      withFiles.set(s.tree_hash, s);
    }
  }

  const known = new Set<string>();
  for (const chunk of chunks([...withFiles.keys()], PARAM_CHUNK)) {
    const rows = await db
      .prepare(
        `SELECT tree_hash FROM trees
         WHERE account_id = ?1 AND tree_hash IN (${placeholders(chunk.length, 2)})`,
      )
      .bind(accountId, ...chunk)
      .all<{ tree_hash: string }>();
    for (const r of rows.results) known.add(r.tree_hash);
  }

  const newTrees = [...withFiles.values()].filter((s) => !known.has(s.tree_hash));
  const treeStmts: D1PreparedStatement[] = [];
  for (const group of chunks(newTrees, 8)) {
    // Bounded concurrency: a 5000-snapshot flush should not open 5000 gzip
    // streams at once.
    await Promise.all(
      group.map(async (s) => {
        const packed = await packTree(s.files as WireFile[]);
        // D1 refuses a value over 2 MB, and one refused INSERT fails the whole
        // batch. Past the cap the tree is recorded without its list: churn
        // skips it, and the snapshots that point at it still land.
        const blob = packed.byteLength <= MAX_BLOB_BYTES ? packed : null;
        treeStmts.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO trees (account_id, tree_hash, files_blob, file_count, total_lines, first_seen)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
            )
            .bind(accountId, s.tree_hash, blob, s.file_count, s.total_lines, now),
        );
      }),
    );
  }
  if (treeStmts.length > 0) await db.batch(treeStmts);

  // --- diff and insert ----------------------------------------------------
  // The batch is walked in captured_at order with the previous state held in
  // memory, so each snapshot is diffed against its true predecessor without a
  // query per row.
  const prev = new Map<number, Prev | null>();
  const inMemoryTrees = new Map<string, WireFile[]>();
  for (const s of batch) {
    if (s.files && s.files.length > 0) inMemoryTrees.set(s.tree_hash, s.files);
  }

  const inserts: D1PreparedStatement[] = [];
  const prints = new Map<string, FilePrints & { projectId: number; capturedAt: number }>();
  let snapshotCount = 0;

  for (const s of batch) {
    const projectId = projectIds.get(s.project);
    if (projectId === undefined) continue;

    if (!prev.has(projectId)) {
      // A late queue flush can arrive older than rows we already hold, so the
      // predecessor is the newest row *before* this capture, not the newest row.
      const row = await db
        .prepare(
          `SELECT tree_hash, total_lines, captured_at, seq FROM snapshots
           WHERE project_id = ?1 AND captured_at < ?2
           ORDER BY captured_at DESC LIMIT 1`,
        )
        .bind(projectId, s.captured_at)
        .first<{ tree_hash: string; total_lines: number; captured_at: number; seq: number | null }>();
      prev.set(projectId, row ? { ...row, files: undefined } : null);
    }

    const p = prev.get(projectId) ?? null;
    const files = s.files && s.files.length > 0 ? s.files : null;

    let added: number | null = null;
    let removed: number | null = null;
    let modified: number | null = null;
    const linesDelta = p ? s.total_lines - p.total_lines : null;

    if (p && p.tree_hash === s.tree_hash) {
      added = removed = modified = 0;
    } else if (p && files) {
      if (p.files === undefined) {
        p.files = inMemoryTrees.get(p.tree_hash) ?? (await getTree(c.env, accountId, p.tree_hash));
      }
      if (p.files) {
        const d = diffTrees(p.files, files);
        added = d.files_added;
        removed = d.files_removed;
        modified = d.files_modified;
      }
    }

    // True line counts. A 0.3 agent sends per-file added/removed on every
    // changed file except on a baseline; an unchanged tree is a real zero.
    const sum = (k: 'added' | 'removed' | 'tail' | 'mid') => s.edits.reduce((a, e) => a + e[k], 0);
    const sameTree = s.unchanged || (p !== null && p.tree_hash === s.tree_hash);
    const hasEdits = s.edits.length > 0 || (s.seq !== null && sameTree);
    const capturedAt = Math.floor(s.captured_at);
    snapshotCount++;

    // Save offsets are relative to the agent's previous capture, which is the
    // stored predecessor when nothing was lost in between.
    const saveTimes =
      s.saves && s.saves.length > 0 && p ? JSON.stringify(s.saves.map((o) => p.captured_at + o)) : null;

    inserts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO snapshots
             (project_id, captured_at, received_at, tree_hash, file_count, total_lines, unchanged,
              files_added, files_removed, files_modified, lines_delta,
              git_head, git_branch, git_dirty, git_ahead, agent_version,
              total_bytes, skipped_files, capture_ms, os, arch,
              git_behind, git_staged, git_modified, git_untracked, git_conflicted,
              git_insertions, git_deletions, git_commits, git_last_commit_at, git_stashes,
              lines_added, lines_removed, tail_edits, mid_edits,
              seq, prev_hash, chain, save_count, save_times, build_at, test_at, fp_files)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,
                   ?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,
                   ?32,?33,?34,?35,?36,?37,?38,?39,?40,?41,?42,?43)`,
        )
        .bind(
          projectId,
          capturedAt,
          now,
          s.tree_hash,
          s.file_count,
          s.total_lines,
          s.unchanged ? 1 : 0,
          added,
          removed,
          modified,
          linesDelta,
          s.git?.head || null,
          s.git?.branch || null,
          s.git ? (s.git.dirty ? 1 : 0) : null,
          s.git?.ahead ?? null,
          s.agent_version || null,
          s.total_bytes,
          s.skipped_files,
          s.capture_ms,
          s.os,
          s.arch,
          s.git?.behind ?? null,
          s.git?.staged ?? null,
          s.git?.modified ?? null,
          s.git?.untracked ?? null,
          s.git?.conflicted ?? null,
          s.git?.insertions ?? null,
          s.git?.deletions ?? null,
          s.git?.commits ?? null,
          s.git?.last_commit_at || null,
          s.git?.stashes ?? null,
          hasEdits ? sum('added') : null,
          hasEdits ? sum('removed') : null,
          hasEdits ? sum('tail') : null,
          hasEdits ? sum('mid') : null,
          s.seq,
          s.prev,
          chainStatus(s, p),
          s.saves ? s.saves.length : null,
          saveTimes,
          s.build_at || null,
          s.test_at || null,
          s.seq !== null ? s.prints.length : null,
        ),
    );

    for (const e of s.edits) {
      inserts.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO file_edits (project_id, captured_at, path_hash, added, removed, tail, mid, lines)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`,
          )
          .bind(projectId, capturedAt, e.path_hash, e.added, e.removed, e.tail, e.mid, e.lines),
      );
    }
    // The batch is in capture order, so a later print of the same file wins.
    for (const fp of s.prints) prints.set(`${projectId}:${fp.path_hash}`, { projectId, capturedAt, ...fp });

    prev.set(projectId, {
      tree_hash: s.tree_hash,
      total_lines: s.total_lines,
      captured_at: capturedAt,
      seq: s.seq,
      files: files ?? undefined,
    });
  }

  for (const fp of prints.values()) {
    inserts.push(
      db
        .prepare(
          `INSERT INTO file_prints (account_id, project_id, path_hash, fps, lines, updated_at)
           VALUES (?1,?2,?3,?4,?5,?6)
           ON CONFLICT (account_id, project_id, path_hash) DO UPDATE
             SET fps = excluded.fps, lines = excluded.lines, updated_at = excluded.updated_at
           WHERE excluded.updated_at >= file_prints.updated_at`,
        )
        .bind(accountId, fp.projectId, fp.path_hash, JSON.stringify(fp.fps), fp.lines, fp.capturedAt),
    );
  }

  for (const group of chunks(inserts, 50)) await db.batch(group);

  return c.json({ accepted: snapshotCount, skipped }, 202);
});

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** `?2, ?3, ...` for an IN list starting at the given 1-based offset. */
function placeholders(count: number, from: number): string {
  return Array.from({ length: count }, (_, i) => `?${from + i}`).join(', ');
}
