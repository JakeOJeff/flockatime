/** Bindings declared in wrangler.jsonc. */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_GAP_SECONDS: string;
  REQUIRE_ACCESS: string;
}

/** One file record as the agent sends it. Path is a hash, never the path. */
export interface WireFile {
  path_hash: string;
  content_hash: string;
  lines: number;
  bytes: number;
  mtime: number;
}

export interface WireGit {
  head: string;
  branch: string;
  dirty: boolean;
  ahead: number;
}

/** Mirrors snapshot.Snapshot in the agent. The body is always an array of these. */
export interface WireSnapshot {
  project: string;
  captured_at: number;
  tree_hash: string;
  file_count: number;
  total_lines: number;
  git?: WireGit;
  files?: WireFile[];
  unchanged?: boolean;
  agent_version: string;
}

export interface TreeDiff {
  files_added: number;
  files_removed: number;
  files_modified: number;
  lines_delta: number;
}
