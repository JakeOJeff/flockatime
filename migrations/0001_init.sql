-- Single-user schema. account_id is carried everywhere so multi-tenant stays
-- open later without a migration, but for now every row uses 'local'.

CREATE TABLE api_keys (
  key_hash   TEXT PRIMARY KEY,          -- sha256 hex of the token; never the token
  account_id TEXT NOT NULL,
  label      TEXT,
  created_at INTEGER NOT NULL,
  last_used  INTEGER,
  revoked_at INTEGER
);

CREATE TABLE projects (
  id         INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (account_id, name)
);

-- One row per distinct tree ever seen. tree_hash is deterministic over the
-- file list, so an identical hash means an identical list: the file list is
-- written to R2 exactly once and every later snapshot just points at it.
CREATE TABLE trees (
  tree_hash   TEXT PRIMARY KEY,
  files_key   TEXT,                     -- R2 object key, NULL if never sent with files
  file_count  INTEGER NOT NULL,
  total_lines INTEGER NOT NULL,
  first_seen  INTEGER NOT NULL
);

CREATE TABLE snapshots (
  id           INTEGER PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id),
  captured_at  INTEGER NOT NULL,        -- agent clock, never rewritten
  received_at  INTEGER NOT NULL,        -- server clock, trustworthy
  tree_hash    TEXT    NOT NULL,
  file_count   INTEGER NOT NULL,
  total_lines  INTEGER NOT NULL,
  unchanged    INTEGER NOT NULL DEFAULT 0,

  -- Diff against the preceding snapshot, computed once at ingest so the
  -- dashboard never has to touch R2.
  files_added    INTEGER,
  files_removed  INTEGER,
  files_modified INTEGER,
  lines_delta    INTEGER,

  git_head   TEXT,
  git_branch TEXT,
  git_dirty  INTEGER,
  git_ahead  INTEGER,

  agent_version TEXT,

  -- The offline queue replays batches whose response was lost. Same project,
  -- same captured_at, same tree means the same capture: ignore the duplicate.
  UNIQUE (project_id, captured_at, tree_hash)
);

CREATE INDEX snapshots_timeline ON snapshots (project_id, captured_at DESC);
CREATE INDEX snapshots_received ON snapshots (received_at DESC);
