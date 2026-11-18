-- snapshot-agent 0.2.2 / 0.3.0 send far more than the columns above held:
-- working-tree counts, repo size, capture cost, platform, true per-file line
-- diffs, a seq/prev hash chain, save times, build/test cache times and
-- winnowed code fingerprints. Every column is nullable: older agents leave
-- them empty and every query treats NULL as "not reported".

-- Size and capture cost.
ALTER TABLE snapshots ADD COLUMN total_bytes   INTEGER;
ALTER TABLE snapshots ADD COLUMN skipped_files INTEGER;
ALTER TABLE snapshots ADD COLUMN capture_ms    INTEGER;
ALTER TABLE snapshots ADD COLUMN os            TEXT;
ALTER TABLE snapshots ADD COLUMN arch          TEXT;

-- Working tree, counts only.
ALTER TABLE snapshots ADD COLUMN git_behind         INTEGER;
ALTER TABLE snapshots ADD COLUMN git_staged         INTEGER;
ALTER TABLE snapshots ADD COLUMN git_modified       INTEGER;
ALTER TABLE snapshots ADD COLUMN git_untracked      INTEGER;
ALTER TABLE snapshots ADD COLUMN git_conflicted     INTEGER;
ALTER TABLE snapshots ADD COLUMN git_insertions     INTEGER;
ALTER TABLE snapshots ADD COLUMN git_deletions      INTEGER;
ALTER TABLE snapshots ADD COLUMN git_commits        INTEGER;
ALTER TABLE snapshots ADD COLUMN git_last_commit_at INTEGER;
ALTER TABLE snapshots ADD COLUMN git_stashes        INTEGER;

-- True line diffs: the sum of every file's added / removed / tail / mid.
-- NULL on a baseline capture or from an agent that predates them, where
-- lines_delta (net) is all there is.
ALTER TABLE snapshots ADD COLUMN lines_added   INTEGER;
ALTER TABLE snapshots ADD COLUMN lines_removed INTEGER;
ALTER TABLE snapshots ADD COLUMN tail_edits    INTEGER;
ALTER TABLE snapshots ADD COLUMN mid_edits     INTEGER;

-- Hash chain. chain is what ingest concluded about seq/prev against the
-- stored predecessor: 'ok', 'start' (seq 1, first ever), 'restart' (seq 1
-- after history, the state file was reset), 'gap' (seq skipped) or 'fork'
-- (prev does not match the predecessor's tree).
ALTER TABLE snapshots ADD COLUMN seq       INTEGER;
ALTER TABLE snapshots ADD COLUMN prev_hash TEXT;
ALTER TABLE snapshots ADD COLUMN chain     TEXT;

-- Saves between captures: how many, and their absolute times as JSON.
ALTER TABLE snapshots ADD COLUMN save_count INTEGER;
ALTER TABLE snapshots ADD COLUMN save_times TEXT;

-- Newest mtime at the top of build output and test caches.
ALTER TABLE snapshots ADD COLUMN build_at INTEGER;
ALTER TABLE snapshots ADD COLUMN test_at  INTEGER;

-- Files that carried fingerprints in this snapshot.
ALTER TABLE snapshots ADD COLUMN fp_files INTEGER;

-- Per-file line edits, one row per changed file per snapshot. Lets churn be
-- an aggregate instead of unpacking stored file lists.
CREATE TABLE file_edits (
  project_id  INTEGER NOT NULL,
  captured_at INTEGER NOT NULL,
  path_hash   TEXT    NOT NULL,
  added       INTEGER NOT NULL,
  removed     INTEGER NOT NULL,
  tail        INTEGER NOT NULL,
  mid         INTEGER NOT NULL,
  lines       INTEGER NOT NULL,
  UNIQUE (project_id, captured_at, path_hash)
);
CREATE INDEX file_edits_window ON file_edits (project_id, captured_at);

-- Latest fingerprints per file, for copy detection across the account.
-- One row per file, overwritten whenever the file's content changes.
CREATE TABLE file_prints (
  account_id TEXT    NOT NULL,
  project_id INTEGER NOT NULL,
  path_hash  TEXT    NOT NULL,
  fps        TEXT    NOT NULL,      -- JSON array of 53-bit integers
  lines      INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, project_id, path_hash)
);
