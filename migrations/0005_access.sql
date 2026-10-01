-- Who may sign in, and who is admin, managed from the Admin page. These add to
-- ALLOWED_EMAILS / ADMIN_EMAILS in wrangler.jsonc, which stay as a floor that
-- the page cannot remove, so no edit here can lock every admin out.
--
-- entry is a full address or an "@domain" (that exact domain). Only a full
-- address can carry the admin role.

CREATE TABLE access (
  entry      TEXT PRIMARY KEY,          -- lowercased email or @domain
  role       TEXT NOT NULL CHECK (role IN ('user', 'admin')),
  added_by   TEXT,                      -- email of the admin who added it
  created_at INTEGER NOT NULL
);
