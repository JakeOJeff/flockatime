import { Hono } from 'hono';
import type { AppEnv } from './types';
import { requireDashboard, sha256 } from './auth';

/**
 * Agent API keys, minted from the dashboard so installing the CLI needs no
 * terminal on the server side. Same scheme as scripts/new-key.mjs: the token
 * is shown once and only its hash is stored. Every key belongs to the account
 * that minted it, and each account sees and revokes only its own.
 */
export const keys = new Hono<AppEnv>();

keys.use('/api/keys', requireDashboard);
keys.use('/api/keys/*', requireDashboard);

/**
 * Writes demand a JSON body. A cross-site HTML form cannot send one without a
 * CORS preflight this Worker never answers, so together with the SameSite
 * session cookie this closes off forged key creation and revocation.
 */
/** One per machine is the norm; this only stops a runaway loop filling the table. */
const MAX_ACTIVE_KEYS = 50;

const isJson =(ct: string | undefined) => (ct ?? '').toLowerCase().startsWith('application/json');

keys.get('/api/keys', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT key_hash AS id, label, created_at, last_used, revoked_at
       FROM api_keys WHERE account_id = ?1
      ORDER BY revoked_at IS NOT NULL, created_at DESC`,
  )
    .bind(c.get('accountId'))
    .all();
  return c.json({ keys: results });
});

keys.post('/api/keys', async (c) => {
  if (!isJson(c.req.header('content-type'))) return c.json({ error: 'expected JSON' }, 415);
  const body = (await c.req.json().catch(() => ({}))) as { label?: unknown };
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 64) : '';

  const active = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM api_keys WHERE account_id = ?1 AND revoked_at IS NULL`,
  )
    .bind(c.get('accountId'))
    .first<{ n: number }>();
  if ((active?.n ?? 0) >= MAX_ACTIVE_KEYS) {
    return c.json({ error: `at most ${MAX_ACTIVE_KEYS} active keys; revoke one first` }, 409);
  }

  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token =
    'flk_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `INSERT INTO api_keys (key_hash, account_id, label, created_at) VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(await sha256(token), c.get('accountId'), label || 'cli', now)
    .run();

  // The only time the token exists outside the machine it is installed on.
  return c.json({ token }, 201);
});

keys.delete('/api/keys/:id', async (c) => {
  if (!isJson(c.req.header('content-type'))) return c.json({ error: 'expected JSON' }, 415);
  const { meta } = await c.env.DB.prepare(
    `UPDATE api_keys SET revoked_at = ?1
      WHERE key_hash = ?2 AND account_id = ?3 AND revoked_at IS NULL`,
  )
    .bind(Math.floor(Date.now() / 1000), c.req.param('id'), c.get('accountId'))
    .run();
  return meta.changes ? c.json({ ok: true }) : c.json({ error: 'no such key' }, 404);
});
