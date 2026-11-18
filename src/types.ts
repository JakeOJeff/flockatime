/** Bindings declared in wrangler.jsonc. */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_GAP_SECONDS: string;
  /** "true" in production: /api/* needs a Hack Club Auth session. */
  REQUIRE_AUTH: string;
  /** Comma-separated emails allowed into the dashboard. Empty = nobody. */
  ALLOWED_EMAILS: string;
  /**
   * The deployment owner. Their first sign-in claims the data recorded before
   * accounts existed, and only they get the HACKATIME_* settings below.
   */
  OWNER_EMAIL?: string;
  /** Comma-separated emails (or "@domain") that get the Admin page. Empty = nobody. */
  ADMIN_EMAILS?: string;
  HACKCLUB_CLIENT_ID: string;
  /** Secret (`wrangler secret put`). */
  HACKCLUB_CLIENT_SECRET: string;
  /** Secret (`wrangler secret put`). Signs the session cookie. */
  SESSION_SECRET: string;
  /** Optional secret: your Hackatime API key, for private stats. */
  HACKATIME_API_KEY?: string;
  /** Optional Hackatime username or Slack ID (public stats only). */
  HACKATIME_USER?: string;
  /** GitHub owner/repo the install scripts download snapshot-agent from. */
  CLI_REPO?: string;
}

/**
 * Hono environment for every route that acts for an account. `accountId` is
 * set by requireDashboard (from the session, or the account an admin is
 * viewing as) or requireAgentKey (from the key), and every query that touches
 * user data is scoped by it.
 */
export type AppEnv = { Bindings: Env; Variables: { accountId: string } };

/**
 * One file record as stored in a tree's file list. Path is a hash, never the
 * path. Only these fields are kept: per-snapshot edits and fingerprints are
 * split out at ingest, since a tree is shared by every snapshot that reaches it.
 */
export interface WireFile {
  path_hash: string;
  content_hash: string;
  lines: number;
  bytes: number;
  mtime: number;
}

/** A file's line edits since the previous capture (agent 0.3+). */
export interface FileEdit {
  path_hash: string;
  added: number;
  removed: number;
  tail: number;
  mid: number;
  lines: number;
}

/** A changed file's winnowed fingerprints (agent 0.3+). */
export interface FilePrints {
  path_hash: string;
  fps: number[];
  lines: number;
}

/** Repository state; everything past `ahead` is counts only (agent 0.2.2+). */
export interface WireGit {
  head: string;
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number | null;
  staged: number | null;
  modified: number | null;
  untracked: number | null;
  conflicted: number | null;
  insertions: number | null;
  deletions: number | null;
  commits: number | null;
  last_commit_at: number | null;
  stashes: number | null;
}

/** Mirrors snapshot.Snapshot in the agent, after normalising. The body is always an array of these. */
export interface WireSnapshot {
  project: string;
  captured_at: number;
  tree_hash: string;
  file_count: number;
  total_lines: number;
  total_bytes: number | null;
  skipped_files: number | null;
  capture_ms: number | null;
  os: string | null;
  arch: string | null;
  git?: WireGit;
  files?: WireFile[];
  /** Files with line edits; empty on a baseline or from an older agent. */
  edits: FileEdit[];
  /** Files with fingerprints. */
  prints: FilePrints[];
  unchanged?: boolean;
  agent_version: string;
  seq: number | null;
  prev: string | null;
  /** Seconds after the previous capture at which a file was saved. */
  saves: number[] | null;
  build_at: number | null;
  test_at: number | null;
}

export interface TreeDiff {
  files_added: number;
  files_removed: number;
  files_modified: number;
  lines_delta: number;
}
