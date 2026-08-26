import type { Context, Next } from 'hono';
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

/**
 * Dashboard auth. Cloudflare Access terminates in front of the Worker and
 * stamps the identity headers, so there is no session code here to get wrong.
 * Left open while REQUIRE_ACCESS is not "true" so `wrangler dev` works.
 */
export async function requireDashboard(c: Context<{ Bindings: Env }>, next: Next) {
  if (c.env.REQUIRE_ACCESS !== 'true') return next();
  if (!c.req.header('Cf-Access-Authenticated-User-Email')) {
    return c.json({ error: 'not authenticated' }, 403);
  }
  return next();
}
