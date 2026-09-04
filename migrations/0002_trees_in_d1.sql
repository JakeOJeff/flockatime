-- Drops the R2 dependency: the file list moves into the trees row itself.
--
-- R2 needs a payment method on the account, which is a hard stop for a
-- deployment that only has to demo. The lists are already gzipped and already
-- deduped by tree_hash, so they fit a BLOB column unchanged -- nothing about
-- how they are written or read has to change, only where they land.
--
-- The trade this makes is a ceiling: a D1 database is capped at 500 MB on the
-- free plan (10 GB paid), against R2's 10 GB free. Fine for a demo, and the
-- README says when it stops being fine.

ALTER TABLE trees ADD COLUMN files_blob BLOB;

-- Pointed at an R2 object that no longer exists.
ALTER TABLE trees DROP COLUMN files_key;
