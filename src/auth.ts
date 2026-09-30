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
    `SELECT k.account_id, a.email
       FROM api_keys k LEFT JOIN accounts a ON a.id = k.account_id
      WHERE k.key_hash = ?1 AND k.revoked_at IS NULL`,
  )
    .bind(hash)
    .first<{ account_id: string; email: string | null }>();

  if (!row) return c.json({ error: 'unknown or revoked key' }, 401);
  if (authOn(c.env) && !(row.email && isAllowed(c.env, row.email))) {
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

/**
 * The signed-in dashboard user, or null. The cookie is HMAC-signed with
 * SESSION_SECRET, so its contents can be trusted once the signature checks.
 * A cookie from before accounts existed has no `sub` and counts as signed out.
 */
export async function sessionUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  const env = c.env;
  if (!env.SESSION_SECRET) return null;
  const raw = await getSignedCookie(c, env.SESSION_SECRET, SESSION_COOKIE);
  if (!raw) return null;
  try {
    const user = JSON.parse(raw) as SessionUser;
    if (typeof user.email !== 'string' || !(user.exp > Date.now() / 1000)) return null;
    if (typeof user.sub !== 'string' || user.sub === '') return null;
    // Re-checked on every request, so removing an email locks it out at once
    // rather than when its cookie expires.
    return isAllowed(env, user.email) ? user : null;
  } catch {
    return null;
  }
}

/**
 * ALLOWED_EMAILS holds full addresses and `@domain` entries. A domain entry
 * matches that exact domain only — `@hackclub.com` does not admit
 * `x@evil-hackclub.com` or `x@sub.hackclub.com`. Fails closed: an empty list
 * lets nobody in.
 */
export function isAllowed(env: Env, email: string): boolean {
  const addr = email.trim().toLowerCase();
  const at = addr.lastIndexOf('@');
  if (at <= 0) return false;
  const domain = addr.slice(at); // includes the "@"
  return (env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => (entry.startsWith('@') ? entry === domain : entry === addr));
}

/** Whether email is the deployment owner (OWNER_EMAIL). */
export function isOwner(env: Env, email: string | undefined): boolean {
  const owner = (env.OWNER_EMAIL ?? '').trim().toLowerCase();
  return owner !== '' && (email ?? '').trim().toLowerCase() === owner;
}

/**
 * Dashboard auth: a Hack Club Auth session (see oauth.ts), which also decides
 * whose data the request sees. Left open while REQUIRE_AUTH is not "true" so
 * `wrangler dev` works without an OAuth app; everything then lands in
 * DEV_ACCOUNT.
 */
export async function requireDashboard(c: Context<AppEnv>, next: Next) {
  if (!authOn(c.env)) {
    c.set('accountId', DEV_ACCOUNT);
    return next();
  }
  const user = await sessionUser(c);
  if (!user) return c.json({ error: 'not authenticated' }, 401);
  c.set('accountId', user.sub);
  return next();
}
