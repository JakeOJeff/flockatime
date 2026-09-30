import type { Context, Next } from 'hono';
import { getSignedCookie } from 'hono/cookie';
import type { Env } from './types';

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

/**
 * Ingest auth. The lookup is by hash, so no comparison runs against the raw
 * token and there is no timing signal to exploit.
 */
export async function requireAgentKey(c: Context<{ Bindings: Env; Variables: { accountId: string } }>, next: Next) {
  const token = bearer(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'missing bearer token' }, 401);

  const hash = await sha256(token);
  const row = await c.env.DB.prepare(
    `SELECT account_id FROM api_keys WHERE key_hash = ?1 AND revoked_at IS NULL`,
  )
    .bind(hash)
    .first<{ account_id: string }>();

  if (!row) return c.json({ error: 'unknown or revoked key' }, 401);

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
  /** Unix seconds. Checked here too, so a replayed cookie dies on time. */
  exp: number;
}

/**
 * The signed-in dashboard user, or null. The cookie is HMAC-signed with
 * SESSION_SECRET, so its contents can be trusted once the signature checks.
 */
export async function sessionUser(c: Context<{ Bindings: Env }>): Promise<SessionUser | null> {
  if (!c.env.SESSION_SECRET) return null;
  const raw = await getSignedCookie(c, c.env.SESSION_SECRET, SESSION_COOKIE);
  if (!raw) return null;
  try {
    const user = JSON.parse(raw) as SessionUser;
    if (typeof user.email !== 'string' || !(user.exp > Date.now() / 1000)) return null;
    // Re-checked on every request, so removing an email locks it out at once
    // rather than when its cookie expires.
    return isAllowed(c.env, user.email) ? user : null;
  } catch {
    return null;
  }
}

/** Fails closed: an empty ALLOWED_EMAILS lets nobody in. */
export function isAllowed(env: Env, email: string): boolean {
  const allowed = (env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

/**
 * Dashboard auth: a Hack Club Auth session (see oauth.ts). Left open while
 * REQUIRE_AUTH is not "true" so `wrangler dev` works without an OAuth app.
 */
export async function requireDashboard(c: Context<{ Bindings: Env }>, next: Next) {
  if (c.env.REQUIRE_AUTH !== 'true') return next();
  if (!(await sessionUser(c))) return c.json({ error: 'not authenticated' }, 401);
  return next();
}
