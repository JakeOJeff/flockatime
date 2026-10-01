import { Hono, type Context } from 'hono';
import type { AppEnv, Env } from './types';
import {
  accessRole,
  authOn,
  configAccess,
  requireAdmin,
  roleFor,
  sessionUser,
  type AccessEntry,
  type Role,
} from './auth';
import { isJson, mintKey } from './keys';

/**
 * The Admin page: every account on the deployment, with what each one has sent
 * and a way to change any of it. Gated by ADMIN_EMAILS (see requireAdmin), and
 * always acting as the admin: these routes take the account they touch from the
 * URL, never from the view-as header.
 *
 * To look at a user's dashboard exactly as they see it, the frontend uses
 * view-as on the ordinary /api/* routes instead; nothing here duplicates them.
 */
export const admin = new Hono<AppEnv>();

admin.use('/api/admin/*', requireAdmin);

// Same CSRF guard as keys.ts: every write demands a JSON body.
admin.on(['POST', 'PATCH', 'DELETE'], '/api/admin/*', async (c, next) => {
  if (!isJson(c.req.header('content-type'))) return c.json({ error: 'expected JSON' }, 415);
  return next();
});

const now = () => Math.floor(Date.now() / 1000);

/** The admin's own account id, so they cannot delete or disable themselves. */
async function selfId(c: Context<AppEnv>): Promise<string | null> {
  return authOn(c.env) ? ((await sessionUser(c))?.sub ?? null) : null;
}

const body = async (c: Context<AppEnv>) =>
  (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Project id by account and name. */
async function projectId(env: Env, account: string, name: string): Promise<number | null> {
  const row = await env.DB.prepare(`SELECT id FROM projects WHERE account_id = ?1 AND name = ?2`)
    .bind(account, name)
    .first<{ id: number }>();
  return row?.id ?? null;
}

/**
 * Drops an account's stored file lists that no snapshot points at any more.
 * Ingest writes a tree a moment before the snapshot that references it, so
 * anything recent is left alone rather than pulled out from under a batch.
 */
const pruneTrees = (env: Env, account: string) =>
  env.DB.prepare(
    `DELETE FROM trees
      WHERE account_id = ?1 AND first_seen < ?2
        AND tree_hash NOT IN (
          SELECT s.tree_hash FROM snapshots s JOIN projects p ON p.id = s.project_id
           WHERE p.account_id = ?1)`,
  ).bind(account, now() - 3600);

/** Deployment-wide counters for the top of the page. */
admin.get('/api/admin/overview', async (c) => {
  const day = now() - 86400;
  const row = await c.env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM accounts)                                   AS accounts,
            (SELECT COUNT(*) FROM accounts WHERE disabled_at IS NOT NULL)      AS disabled,
            (SELECT COUNT(*) FROM projects)                                   AS projects,
            (SELECT COUNT(*) FROM snapshots)                                  AS snapshots,
            (SELECT COUNT(*) FROM snapshots WHERE received_at >= ?1)          AS snapshots_24h,
            (SELECT COUNT(DISTINCT p.account_id) FROM snapshots s
               JOIN projects p ON p.id = s.project_id WHERE s.received_at >= ?1) AS active_24h,
            (SELECT COUNT(*) FROM api_keys WHERE revoked_at IS NULL)          AS active_keys,
            (SELECT COUNT(*) FROM trees)                                      AS trees,
            (SELECT COALESCE(SUM(LENGTH(files_blob)), 0) FROM trees)          AS stored_bytes`,
  )
    .bind(day)
    .first();
  return c.json(row);
});

/**
 * Every account id that owns anything, not only those with an accounts row:
 * data recorded before accounts existed ('local'), or keys minted for an id
 * that never signed in, would otherwise be invisible here.
 */
admin.get('/api/admin/users', async (c) => {
  const { results } = await c.env.DB.prepare(
    `WITH ids AS (
            SELECT id FROM accounts
            UNION SELECT account_id FROM projects
            UNION SELECT account_id FROM api_keys),
          snaps AS (
            SELECT p.account_id,
                   COUNT(DISTINCT p.id)  AS projects,
                   COUNT(s.id)           AS snapshots,
                   MAX(s.received_at)    AS last_received
              FROM projects p LEFT JOIN snapshots s ON s.project_id = p.id
             GROUP BY p.account_id),
          ks AS (
            SELECT account_id,
                   SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS active_keys,
                   MAX(last_used)                                      AS last_key_use
              FROM api_keys GROUP BY account_id)
     SELECT ids.id, a.email, a.name, a.created_at, a.last_login, a.disabled_at,
            COALESCE(snaps.projects, 0)  AS projects,
            COALESCE(snaps.snapshots, 0) AS snapshots,
            snaps.last_received,
            COALESCE(ks.active_keys, 0)  AS active_keys,
            ks.last_key_use
       FROM ids
       LEFT JOIN accounts a ON a.id = ids.id
       LEFT JOIN snaps ON snaps.account_id = ids.id
       LEFT JOIN ks ON ks.account_id = ids.id
      ORDER BY MAX(COALESCE(snaps.last_received, 0), COALESCE(a.last_login, 0)) DESC`,
  ).all<{ email: string | null }>();

  // What each email may do right now, from the same rules as sign-in, worked
  // out against one read of the access table rather than a query per row.
  const { results: entries } = await c.env.DB.prepare(`SELECT entry, role FROM access`).all<AccessEntry>();
  const cfg = configAccess(c.env);
  return c.json({
    users: results.map((u) => ({ ...u, role: u.email ? roleFor(u.email, cfg, entries) : null })),
  });
});

/** One account in full: profile, totals, every project and every key. */
admin.get('/api/admin/users/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const week = now() - 7 * 86400;

  const [account, totals, projects, keys] = await db.batch([
    db.prepare(`SELECT id, email, name, created_at, last_login, disabled_at FROM accounts WHERE id = ?1`).bind(id),
    db
      .prepare(
        `SELECT COUNT(s.id)                                                  AS snapshots,
                SUM(CASE WHEN s.unchanged = 0 THEN 1 ELSE 0 END)             AS active_snapshots,
                SUM(CASE WHEN s.received_at >= ?2 THEN 1 ELSE 0 END)         AS snapshots_7d,
                SUM(CASE WHEN s.lines_delta > 0 THEN s.lines_delta END)      AS lines_added,
                SUM(CASE WHEN s.lines_delta < 0 THEN -s.lines_delta END)     AS lines_removed,
                MIN(s.captured_at)                                           AS first_seen,
                MAX(s.received_at)                                           AS last_received,
                (SELECT COUNT(*) FROM trees WHERE account_id = ?1)           AS trees,
                (SELECT COALESCE(SUM(LENGTH(files_blob)), 0)
                   FROM trees WHERE account_id = ?1)                         AS stored_bytes
           FROM snapshots s JOIN projects p ON p.id = s.project_id
          WHERE p.account_id = ?1`,
      )
      .bind(id, week),
    db
      .prepare(
        `SELECT p.name, p.created_at,
                (SELECT COUNT(*) FROM snapshots WHERE project_id = p.id) AS snapshots,
                s.captured_at, s.received_at, s.file_count, s.total_lines,
                s.git_branch, s.git_head, s.git_dirty, s.agent_version
           FROM projects p
           LEFT JOIN snapshots s ON s.id = (
             SELECT id FROM snapshots WHERE project_id = p.id ORDER BY captured_at DESC LIMIT 1)
          WHERE p.account_id = ?1
          ORDER BY s.captured_at DESC NULLS LAST`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT key_hash AS id, label, created_at, last_used, revoked_at
           FROM api_keys WHERE account_id = ?1
          ORDER BY revoked_at IS NOT NULL, created_at DESC`,
      )
      .bind(id),
  ]);

  const profile = account.results[0] ?? null;
  if (!profile && projects.results.length === 0 && keys.results.length === 0) {
    return c.json({ error: 'no such account' }, 404);
  }
  return c.json({
    id,
    account: profile,
    totals: totals.results[0] ?? null,
    projects: projects.results,
    keys: keys.results,
  });
});

/**
 * The raw snapshot log: everything the account's agents sent, newest first.
 * Paged by snapshot id (`before`), optionally narrowed to one project.
 */
admin.get('/api/admin/users/:id/snapshots', async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 100, 1), 500);
  const before = Number(c.req.query('before')) || Number.MAX_SAFE_INTEGER;
  const project = c.req.query('project') || null;

  const { results } = await c.env.DB.prepare(
    `SELECT s.id, p.name AS project, s.captured_at, s.received_at, s.tree_hash,
            s.file_count, s.total_lines, s.unchanged,
            s.files_added, s.files_removed, s.files_modified, s.lines_delta,
            s.git_head, s.git_branch, s.git_dirty, s.git_ahead, s.agent_version
       FROM snapshots s JOIN projects p ON p.id = s.project_id
      WHERE p.account_id = ?1 AND s.id < ?2 AND (?3 IS NULL OR p.name = ?3)
      ORDER BY s.id DESC
      LIMIT ?4`,
  )
    .bind(c.req.param('id'), before, project, limit)
    .all();
  return c.json({ snapshots: results, more: results.length === limit });
});

/**
 * Creates (or fills in) an account row. The id is normally a Hack Club Auth
 * `sub`: an account made with someone's real sub is the one they land in when
 * they sign in, keys and all. Without an id, a fresh one is made up, which
 * nobody can sign in as — useful for holding data or minting keys by hand.
 */
admin.post('/api/admin/users', async (c) => {
  const b = await body(c);
  const email = text(b.email, 254).toLowerCase();
  if (!email.includes('@')) return c.json({ error: 'email required' }, 400);
  const id = text(b.id, 128) || `manual_${crypto.randomUUID()}`;
  const name = text(b.name, 128) || null;

  const { meta } = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO accounts (id, email, name, created_at, last_login) VALUES (?1, ?2, ?3, ?4, 0)`,
  )
    .bind(id, email, name, now())
    .run();
  return meta.changes ? c.json({ id }, 201) : c.json({ error: 'account id already exists' }, 409);
});

/** Edit name / email, or disable / re-enable. An id with data but no row gets one. */
admin.patch('/api/admin/users/:id', async (c) => {
  const id = c.req.param('id');
  const b = await body(c);
  if (b.disabled === true && id === (await selfId(c))) {
    return c.json({ error: 'you cannot disable yourself' }, 400);
  }

  const current = await c.env.DB.prepare(`SELECT email, name, disabled_at FROM accounts WHERE id = ?1`)
    .bind(id)
    .first<{ email: string; name: string | null; disabled_at: number | null }>();

  const email = 'email' in b ? text(b.email, 254).toLowerCase() : current?.email ?? '';
  if (!email.includes('@')) return c.json({ error: 'email required' }, 400);
  const name = 'name' in b ? text(b.name, 128) || null : current?.name ?? null;
  const disabled_at =
    'disabled' in b ? (b.disabled === true ? current?.disabled_at ?? now() : null) : current?.disabled_at ?? null;

  await c.env.DB.prepare(
    `INSERT INTO accounts (id, email, name, created_at, last_login, disabled_at)
     VALUES (?1, ?2, ?3, ?5, 0, ?4)
     ON CONFLICT (id) DO UPDATE SET email = ?2, name = ?3, disabled_at = ?4`,
  )
    .bind(id, email, name, disabled_at, now())
    .run();
  return c.json({ ok: true });
});

/**
 * Deletes an account and everything filed under it. This does not keep them
 * out: an allowed email can sign in again into a fresh, empty account. Disable
 * the account (PATCH) to keep them out.
 */
admin.delete('/api/admin/users/:id', async (c) => {
  const id = c.req.param('id');
  if (id === (await selfId(c))) return c.json({ error: 'you cannot delete yourself' }, 400);
  const db = c.env.DB;
  await db.batch([
    db.prepare(`DELETE FROM snapshots WHERE project_id IN (SELECT id FROM projects WHERE account_id = ?1)`).bind(id),
    db.prepare(`DELETE FROM projects WHERE account_id = ?1`).bind(id),
    db.prepare(`DELETE FROM trees WHERE account_id = ?1`).bind(id),
    db.prepare(`DELETE FROM api_keys WHERE account_id = ?1`).bind(id),
    db.prepare(`DELETE FROM accounts WHERE id = ?1`).bind(id),
  ]);
  return c.json({ ok: true });
});

/** Mints an agent key for the account. The token is returned once, as from /api/keys. */
admin.post('/api/admin/users/:id/keys', async (c) => {
  const label = text((await body(c)).label, 64) || 'admin';
  return c.json({ token: await mintKey(c.env, c.req.param('id'), label) }, 201);
});

/** Rename, revoke or restore any key. */
admin.patch('/api/admin/keys/:key', async (c) => {
  const b = await body(c);
  const db = c.env.DB;
  const key = c.req.param('key');
  const stmts = [];
  if ('label' in b) stmts.push(db.prepare(`UPDATE api_keys SET label = ?2 WHERE key_hash = ?1`).bind(key, text(b.label, 64) || 'cli'));
  if (b.revoked === true) stmts.push(db.prepare(`UPDATE api_keys SET revoked_at = ?2 WHERE key_hash = ?1 AND revoked_at IS NULL`).bind(key, now()));
  if (b.revoked === false) stmts.push(db.prepare(`UPDATE api_keys SET revoked_at = NULL WHERE key_hash = ?1`).bind(key));
  if (stmts.length === 0) return c.json({ error: 'nothing to change' }, 400);
  const results = await db.batch(stmts);
  return results.some((r) => r.meta.changes) ? c.json({ ok: true }) : c.json({ error: 'no such key' }, 404);
});

/** Removes a key outright, rather than leaving it revoked in the list. */
admin.delete('/api/admin/keys/:key', async (c) => {
  const { meta } = await c.env.DB.prepare(`DELETE FROM api_keys WHERE key_hash = ?1`).bind(c.req.param('key')).run();
  return meta.changes ? c.json({ ok: true }) : c.json({ error: 'no such key' }, 404);
});

/**
 * Rename a project, or move it to another account (`to`). A move copies the
 * file lists its snapshots point at, since trees are per account and churn
 * reads them back. Either fails on a name the destination already has.
 */
admin.patch('/api/admin/users/:id/projects/:name', async (c) => {
  const from = c.req.param('id');
  const pid = await projectId(c.env, from, c.req.param('name'));
  if (pid === null) return c.json({ error: 'no such project' }, 404);

  const b = await body(c);
  const name = text(b.name, 128) || c.req.param('name');
  const to = text(b.to, 128) || from;
  if (to === from && name === c.req.param('name')) return c.json({ ok: true });
  if ((await projectId(c.env, to, name)) !== null) {
    return c.json({ error: 'that account already has a project with this name' }, 409);
  }

  const db = c.env.DB;
  const stmts = [db.prepare(`UPDATE projects SET account_id = ?2, name = ?3 WHERE id = ?1`).bind(pid, to, name)];
  if (to !== from) {
    stmts.unshift(
      db
        .prepare(
          `INSERT OR IGNORE INTO trees (account_id, tree_hash, files_blob, file_count, total_lines, first_seen)
           SELECT ?2, tree_hash, files_blob, file_count, total_lines, first_seen
             FROM trees
            WHERE account_id = ?1 AND tree_hash IN (SELECT tree_hash FROM snapshots WHERE project_id = ?3)`,
        )
        .bind(from, to, pid),
    );
    stmts.push(pruneTrees(c.env, from));
  }
  await db.batch(stmts);
  return c.json({ ok: true });
});

/** Deletes a project with all its snapshots. */
admin.delete('/api/admin/users/:id/projects/:name', async (c) => {
  const account = c.req.param('id');
  const pid = await projectId(c.env, account, c.req.param('name'));
  if (pid === null) return c.json({ error: 'no such project' }, 404);
  const db = c.env.DB;
  await db.batch([
    db.prepare(`DELETE FROM snapshots WHERE project_id = ?1`).bind(pid),
    db.prepare(`DELETE FROM projects WHERE id = ?1`).bind(pid),
    pruneTrees(c.env, account),
  ]);
  return c.json({ ok: true });
});

/**
 * Deletes one snapshot. The diff stored on the snapshot after it still
 * describes the change from the deleted one; it is not recomputed.
 */
admin.delete('/api/admin/snapshots/:sid', async (c) => {
  const sid = Number(c.req.param('sid'));
  const owner = await c.env.DB.prepare(
    `SELECT p.account_id FROM snapshots s JOIN projects p ON p.id = s.project_id WHERE s.id = ?1`,
  )
    .bind(sid)
    .first<{ account_id: string }>();
  if (!owner) return c.json({ error: 'no such snapshot' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM snapshots WHERE id = ?1`).bind(sid),
    pruneTrees(c.env, owner.account_id),
  ]);
  return c.json({ ok: true });
});

/* ---------- access: who may sign in, who is admin ---------- */

/** A lowercased full address or "@domain", or null if it is neither. */
function accessEntry(v: unknown): string | null {
  const e = text(v, 254).toLowerCase();
  if (/^@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) return e;
  if (/^[^\s@,]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) return e;
  return null;
}

/**
 * The access list: the page's own entries, plus the fixed ones from
 * wrangler.jsonc, which are shown but cannot be changed from here.
 */
admin.get('/api/admin/access', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT entry, role, added_by, created_at FROM access ORDER BY role = 'admin' DESC, entry`,
  ).all();
  return c.json({ entries: results, config: configAccess(c.env) });
});

/**
 * Adds an entry or changes its role. Admin needs a full address. An admin
 * cannot demote their own entry here, though one in ADMIN_EMAILS keeps admin
 * whatever this table says.
 */
admin.post('/api/admin/access', async (c) => {
  const b = await body(c);
  const entry = accessEntry(b.entry);
  if (!entry) return c.json({ error: 'enter an email address or an @domain' }, 400);
  const role: Role = b.role === 'admin' ? 'admin' : 'user';
  if (role === 'admin' && entry.startsWith('@')) {
    return c.json({ error: 'admin can only go to a single email address, not a domain' }, 400);
  }

  const me = authOn(c.env) ? await sessionUser(c) : null;
  if (me && role !== 'admin' && entry === me.email.toLowerCase() && !(await stillAdminWithout(c.env, entry))) {
    return c.json({ error: 'you cannot remove your own admin' }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO access (entry, role, added_by, created_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (entry) DO UPDATE SET role = ?2`,
  )
    .bind(entry, role, me?.email ?? null, now())
    .run();
  return c.json({ ok: true }, 201);
});

/**
 * Removes an entry. Whoever it let in is locked out on their next request —
 * dashboard and agents — unless wrangler.jsonc or another entry still admits them.
 */
admin.delete('/api/admin/access/:entry', async (c) => {
  const entry = c.req.param('entry').toLowerCase();
  const me = authOn(c.env) ? await sessionUser(c) : null;
  if (me && entry === me.email.toLowerCase() && !(await stillAdminWithout(c.env, entry))) {
    return c.json({ error: 'you cannot remove your own access' }, 400);
  }
  const { meta } = await c.env.DB.prepare(`DELETE FROM access WHERE entry = ?1`).bind(entry).run();
  return meta.changes ? c.json({ ok: true }) : c.json({ error: 'no such entry' }, 404);
});

/** Whether email stays admin from wrangler.jsonc alone, with its table entry gone. */
async function stillAdminWithout(env: Env, email: string): Promise<boolean> {
  return configAccess(env).admins.includes(email);
}

/**
 * One email's effective role, for the account page, with where it comes from:
 * its own entry (which the page can change) and whether wrangler.jsonc or a
 * domain entry also lets it in (which removing its own entry would not undo).
 */
admin.get('/api/admin/access/check', async (c) => {
  const email = text(c.req.query('email'), 254).toLowerCase();
  if (!email.includes('@')) return c.json({ role: null, entry: null, other: false });
  const domain = email.slice(email.lastIndexOf('@'));
  const [role, entry, viaDomain] = await Promise.all([
    accessRole(c.env, email),
    c.env.DB.prepare(`SELECT entry, role FROM access WHERE entry = ?1`).bind(email).first<AccessEntry>(),
    c.env.DB.prepare(`SELECT 1 AS y FROM access WHERE entry = ?1`).bind(domain).first(),
  ]);
  const cfg = configAccess(c.env);
  return c.json({
    role,
    entry: entry ?? null,
    other: !!viaDomain || cfg.allowed.includes(email) || cfg.allowed.includes(domain),
    config_admin: cfg.admins.includes(email),
  });
});
