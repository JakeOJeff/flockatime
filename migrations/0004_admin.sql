-- Admin: an account can be switched off without deleting it. Deleting alone
-- would not keep anyone out, since an allowed email simply signs in again and
-- gets a fresh account; a disabled one is refused at sign-in, on every
-- dashboard request and at ingest.

ALTER TABLE accounts ADD COLUMN disabled_at INTEGER;
