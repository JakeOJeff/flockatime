-- Which agent key sent each snapshot, so Settings can list machines: what
-- each one runs, which repos it reports and how busy it has been.
ALTER TABLE snapshots ADD COLUMN key_hash TEXT;

CREATE INDEX snapshots_key ON snapshots (key_hash, received_at);

-- Older snapshots never recorded their key. Attribute one only when exactly
-- one of its account's keys could have sent it: created before it arrived,
-- not yet revoked, and used at some point. Anything ambiguous stays NULL.
UPDATE snapshots
   SET key_hash = (
     SELECT k.key_hash
       FROM api_keys k JOIN projects p ON p.account_id = k.account_id
      WHERE p.id = snapshots.project_id
        AND k.created_at <= snapshots.received_at
        AND (k.revoked_at IS NULL OR k.revoked_at >= snapshots.received_at)
        AND k.last_used IS NOT NULL
   )
 WHERE key_hash IS NULL
   AND (
     SELECT COUNT(*)
       FROM api_keys k JOIN projects p ON p.account_id = k.account_id
      WHERE p.id = snapshots.project_id
        AND k.created_at <= snapshots.received_at
        AND (k.revoked_at IS NULL OR k.revoked_at >= snapshots.received_at)
        AND k.last_used IS NOT NULL
   ) = 1;
