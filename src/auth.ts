import type { Context, Next } from 'hono';
import { getSignedCookie } from 'hono/cookie';
import type { AppEnv, Env } from './types';

/** sha256 hex. Keys are stored hashed, so a leaked database is not a leaked key. */
export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, ...rest] = header.split(' ');
  if (scheme.toLowerCase() !== 'bearer' || rest.length === 0) return null;
  const token = rest.join(' ').trim();
  return token.length > 0 ? token : null;
}

/** The account everything is filed under while REQUIRE_AUTH is off (local dev). */
export const DEV_ACCOUNT = 'local';

/**
 * Fails closed: only an explicit "false" (.dev.vars) turns the gate off, so a
 * missing or mistyped REQUIRE_AUTH in production cannot open the dashboard.
 */
export const authOn = (env: Env) => env.REQUIRE_AUTH !== 'false';

/**
 * Ingest auth. The lookup is by hash, so no comparison runs against the raw
 * token and there is no timing signal to exploit.
 *
 * The key's account must still be on the allowlist: removing someone from
 * ALLOWED_EMAILS stops their agents as well as their dashboard.
 */
export async function requireAgentKey(c: Context<AppEnv>, next: Next) {
  const token = bearer(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'missing bearer token' }, 401);

  const hash = await sha256(token);
  const row = await c.env.DB.prepare(
    `SELECT k.account_id, a.email, a.disabled_at
       FROM api_keys k LEFT JOIN accounts a ON a.id = k.account_id
      WHERE k.key_hash = ?1 AND k.revoked_at IS NULL`,
  )
    .bind(hash)
    .first<{ account_id: string; email: string | null; disabled_at: number | null }>();

  if (!row) return c.json({ error: 'unknown or revoked key' }, 401);
  if (authOn(c.env) && !(row.email && (await isAllowed(c.env, row.email)) && !row.disabled_at)) {
    return c.json({ error: 'account not allowed' }, 401);
  }

  c.set('accountId', row.account_id);
  // Fire-and-forget: a failed last_used write must never fail an ingest.
  c.executionCtx.waitUntil(
    c.env.DB.prepare(`UPDATE api_keys SET last_used = ?1 WHERE key_hash = ?2`)
      .bind(Math.floor(Date.now() / 1000), hash)
      .run()
      .then(() => undefined)
      .catch(() => undefined),
  );

  return next();
}

export const SESSION_COOKIE = 'fk_session';
export const SESSION_TTL_SECONDS = 7 * 86400;

export interface SessionUser {
  email: string;
  name: string | null;
  /** Hack Club Auth user id: the account id every row is filed under. */
  sub: string;
  /** Unix seconds. Checked here too, so a replayed cookie dies on time. */
  exp: number;
}

/** A session that checked out, with what this email may do right now. */
export interface SignedIn extends SessionUser {
  admin: boolean;
}

/**
 * The signed-in dashboard user, or null. The cookie is HMAC-signed with
 * SESSION_SECRET, so its contents can be trusted once the signature checks.
 * A cookie from before accounts existed has no `sub` and counts as signed out.
 */
export async function sessionUser(c: Context<AppEnv>): Promise<SignedIn | null> {
  const env = c.env;
  if (!env.SESSION_SECRET) return null;
  const raw = await getSignedCookie(c, env.SESSION_SECRET, SESSION_COOKIE);
  if (!raw) return null;
  let user: SessionUser;
  try {
    user = JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
  if (typeof user.email !== 'string' || !(user.exp > Date.now() / 1000)) return null;
  if (typeof user.sub !== 'string' || user.sub === '') return null;
  // Re-checked on every request, so removing an email (or an admin) takes
  // effect at once rather than when its cookie expires.
  const role = await accessRole(env, user.email);
  return role ? { ...user, admin: role === 'admin' } : null;
}

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export type Role = 'user' | 'admin';

/**
 * What email may do: 'admin', 'user' (sign in), or null (nothing).
 *
 * Two sources, either of which grants: ALLOWED_EMAILS / ADMIN_EMAILS in
 * wrangler.jsonc, a floor the Admin page cannot remove, and the `access` table
 * the Admin page edits. Both hold full addresses and `@domain` entries; a
 * domain entry matches that exact domain only — `@hackclub.com` does not admit
 * `x@evil-hackclub.com` or `x@sub.hackclub.com`. A domain in ADMIN_EMAILS makes
 * that whole domain admin; in the table, admin only ever goes to a full
 * address, so the page cannot hand it to a domain. Fails closed: with both
 * empty nobody gets in.
 */
export async function accessRole(env: Env, email: string): Promise<Role | null> {
  const addr = email.trim().toLowerCase();
  const domain = addr.slice(addr.lastIndexOf('@'));
  const { results } = await env.DB.prepare(`SELECT entry, role FROM access WHERE entry IN (?1, ?2)`)
    .bind(addr, domain)
    .all<AccessEntry>();
  return roleFor(email, configAccess(env), results);
}

export interface AccessEntry {
  entry: string;
  role: Role;
}

/** accessRole's rules against entries already read, so a list can be checked in one query. */
export function roleFor(
  email: string,
  config: ReturnType<typeof configAccess>,
  entries: AccessEntry[],
): Role | null {
  const addr = email.trim().toLowerCase();
  const at = addr.lastIndexOf('@');
  if (at <= 0) return null;
  const domain = addr.slice(at); // includes the "@"
  const hit = (e: string) => e === addr || e === domain;

  if (config.admins.some(hit)) return 'admin';
  if (entries.some((e) => e.role === 'admin' && e.entry === addr)) return 'admin';
  return config.allowed.some(hit) || entries.some((e) => hit(e.entry)) ? 'user' : null;
}

/** Whether email may sign in (and its agents may send). */
export const isAllowed = async (env: Env, email: string) => (await accessRole(env, email)) !== null;

/** Whether email is the deployment owner (OWNER_EMAIL). */
export function isOwner(env: Env, email: string | undefined): boolean {
  const owner = (env.OWNER_EMAIL ?? '').trim().toLowerCase();
  return owner !== '' && (email ?? '').trim().toLowerCase() === owner;
}

/** The fixed entries from wrangler.jsonc, for the Admin page to show beside its own. */
export const configAccess = (env: Env) => ({
  allowed: list(env.ALLOWED_EMAILS),
  admins: list(env.ADMIN_EMAILS),
});

/**
 * Sent by the dashboard while an admin is viewing as another account. A header
 * rather than a query param or cookie: a cross-site page cannot set it without
 * a CORS preflight this Worker never answers.
 */
export const VIEW_AS_HEADER = 'x-flockatime-as';

/**
 * Dashboard auth: a Hack Club Auth session (see oauth.ts), which also decides
 * whose data the request sees. Left open while REQUIRE_AUTH is not "true" so
 * `wrangler dev` works without an OAuth app; everything then lands in
 * DEV_ACCOUNT.
 *
 * An admin sending VIEW_AS_HEADER is scoped to that account instead, so every
 * dashboard route serves (and writes) that user's data unchanged. Anyone else
 * sending it is ignored and sees their own.
 */
export async function requireDashboard(c: Context<AppEnv>, next: Next) {
  // keys.ts and api.ts both guard /api/keys; one check per request is enough.
  if (c.get('accountId')) return next();

  const viewAs = c.req.header(VIEW_AS_HEADER)?.trim().slice(0, 128) || null;
  if (!authOn(c.env)) {
    c.set('accountId', viewAs ?? DEV_ACCOUNT);
    return next();
  }
  const user = await sessionUser(c);
  if (!user) return c.json({ error: 'not authenticated' }, 401);

  const account = await c.env.DB.prepare(`SELECT disabled_at FROM accounts WHERE id = ?1`)
    .bind(user.sub)
    .first<{ disabled_at: number | null }>();
  if (account?.disabled_at) return c.json({ error: 'not authenticated' }, 401);

  c.set('accountId', viewAs && user.admin ? viewAs : user.sub);
  return next();
}

/**
 * Admin routes. Always the admin's own identity: the view-as header has no
 * effect here, so an admin page can never act through someone else. Everyone
 * is admin while auth is off, as everyone already is the one local account.
 */
export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  if (!authOn(c.env)) return next();
  const user = await sessionUser(c);
  if (!user) return c.json({ error: 'not authenticated' }, 401);
  if (!user.admin) return c.json({ error: 'not found' }, 404);
  return next();
}
