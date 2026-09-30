-- Multi-user: every signed-in Hack Club account gets its own keys, projects
-- and trees. account_id is the Hack Club Auth `sub`; 'local' remains for
-- `wrangler dev` with auth off, and for rows recorded before this migration
-- until OWNER_EMAIL signs in and claims them (see oauth.ts).

CREATE TABLE accounts (
  id         TEXT PRIMARY KEY,          -- Hack Club Auth sub
  email      TEXT NOT NULL,
  name       TEXT,
  created_at INTEGER NOT NULL,
  last_login INTEGER NOT NULL
);

-- trees was keyed by tree_hash alone, so one account's upload could stand in
-- for another's list under the same hash. Key it by account as well.
CREATE TABLE trees_new (
  account_id  TEXT    NOT NULL,
  tree_hash   TEXT    NOT NULL,
  files_blob  BLOB,
  file_count  INTEGER NOT NULL,
  total_lines INTEGER NOT NULL,
  first_seen  INTEGER NOT NULL,
  PRIMARY KEY (account_id, tree_hash)
);

-- Only one account has ever existed.
INSERT INTO trees_new (account_id, tree_hash, files_blob, file_count, total_lines, first_seen)
  SELECT 'local', tree_hash, files_blob, file_count, total_lines, first_seen FROM trees;

DROP TABLE trees;
ALTER TABLE trees_new RENAME TO trees;

CREATE INDEX api_keys_account ON api_keys (account_id);
