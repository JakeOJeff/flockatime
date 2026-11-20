import { Hono } from 'hono';
import type { AppEnv, Env } from './types';
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

export const isJson = (ct: string | undefined) => (ct ?? '').toLowerCase().startsWith('application/json');

/** Days of per-key activity returned for the Settings sparkline. */
const ACTIVITY_DAYS = 30;

/**
 * Every key with what its machine has sent: snapshot and repo counts, the
 * platform and agent version of its latest snapshot, and snapshots per local
 * day (`tz` = the viewer's UTC offset in minutes) over the last 30 days,
 * oldest first. Snapshots from before keys were recorded count for no key.
 */
keys.get('/api/keys', async (c) => {
  const account = c.get('accountId');
  const tz = Math.max(-840, Math.min(840, Number(c.req.query('tz')) || 0)) * 60;
  const now = Math.floor(Date.now() / 1000);
  const today = Math.floor((now + tz) / 86400);
  const from = (today - ACTIVITY_DAYS + 1) * 86400 - tz;

  const [{ results }, { results: days }] = await Promise.all([
    c.env.DB.prepare(
      `SELECT k.key_hash AS id, k.label, k.created_at, k.last_used, k.revoked_at,
              (SELECT COUNT(*) FROM snapshots s WHERE s.key_hash = k.key_hash)                 AS snapshots,
              (SELECT COUNT(DISTINCT project_id) FROM snapshots s WHERE s.key_hash = k.key_hash) AS repos,
              l.os, l.arch, l.agent_version, l.received_at AS last_snapshot
         FROM api_keys k
         LEFT JOIN snapshots l ON l.id = (
           SELECT id FROM snapshots WHERE key_hash = k.key_hash ORDER BY received_at DESC LIMIT 1
         )
        WHERE k.account_id = ?1
        ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC`,
    )
      .bind(account)
      .all<{ id: string }>(),
    c.env.DB.prepare(
      `SELECT s.key_hash AS id, (s.received_at + ?3) / 86400 AS day, COUNT(*) AS n
         FROM snapshots s JOIN api_keys k ON k.key_hash = s.key_hash
        WHERE k.account_id = ?1 AND s.received_at >= ?2
        GROUP BY s.key_hash, day`,
    )
      .bind(account, from, tz)
      .all<{ id: string; day: number; n: number }>(),
  ]);

  const activity = new Map<string, number[]>();
  for (const d of days) {
    const i = d.day - (today - ACTIVITY_DAYS + 1);
    if (i < 0 || i >= ACTIVITY_DAYS) continue;
    let row = activity.get(d.id);
    if (!row) activity.set(d.id, (row = new Array<number>(ACTIVITY_DAYS).fill(0)));
    row[i] += d.n;
  }

  return c.json({
    keys: results.map((k) => ({ ...k, daily: activity.get(k.id) ?? new Array<number>(ACTIVITY_DAYS).fill(0) })),
  });
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

  // The only time the token exists outside the machine it is installed on.
  return c.json({ token: await mintKey(c.env, c.get('accountId'), label || 'cli') }, 201);
});

/** Stores a new key for account and returns the token, which is never stored. */
export async function mintKey(env: Env, account: string, label: string): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token =
    'flk_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await env.DB.prepare(
    `INSERT INTO api_keys (key_hash, account_id, label, created_at) VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(await sha256(token), account, label, Math.floor(Date.now() / 1000))
    .run();
  return token;
}

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
