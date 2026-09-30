import { Hono, type Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { AppEnv, Env } from './types';
import {
  DEV_ACCOUNT,
  authOn,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  isAllowed,
  isOwner,
  sessionUser,
  type SessionUser,
} from './auth';

/**
 * Dashboard login via Hack Club Auth (OAuth 2.0 authorization code flow).
 * The code is exchanged server-side and the identity read from userinfo over
 * TLS, so there is no ID token to verify and no JWKS to fetch.
 */
const HCA = 'https://auth.hackclub.com';
const SCOPES = 'openid email name';
const STATE_COOKIE = 'fk_oauth_state';

export const oauth = new Hono<AppEnv>();

const redirectUri = (url: string) => new URL('/auth/callback', url).toString();
const secure = (url: string) => new URL(url).protocol === 'https:';

/**
 * Back to the dashboard with a short reason code, which the logged-out screen
 * turns into a message. Only fixed codes go in the URL, never provider text.
 */
type FailReason = 'not_configured' | 'cancelled' | 'expired' | 'failed' | 'no_email' | 'not_allowed';
const failed = (c: Context<AppEnv>, reason: FailReason) => c.redirect(`/?auth_error=${reason}`);

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

oauth.get('/auth/login', async (c) => {
  if (!c.env.HACKCLUB_CLIENT_ID || !c.env.SESSION_SECRET) {
    return failed(c, 'not_configured');
  }

  const state = randomToken();
  await setSignedCookie(c, STATE_COOKIE, state, c.env.SESSION_SECRET, {
    path: '/auth',
    httpOnly: true,
    secure: secure(c.req.url),
    // Lax, not Strict: the callback is a top-level redirect back from
    // auth.hackclub.com, and Strict would drop the cookie on it.
    sameSite: 'Lax',
    maxAge: 600,
  });

  const url = new URL('/oauth/authorize', HCA);
  url.searchParams.set('client_id', c.env.HACKCLUB_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri(c.req.url));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);
  return c.redirect(url.toString());
});

oauth.get('/auth/callback', async (c) => {
  const secret = c.env.SESSION_SECRET;
  if (!c.env.HACKCLUB_CLIENT_ID || !c.env.HACKCLUB_CLIENT_SECRET || !secret) {
    return failed(c, 'not_configured');
  }

  const expected = await getSignedCookie(c, secret, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: '/auth', secure: secure(c.req.url) });

  const { code, state, error } = c.req.query();
  if (error) return failed(c, 'cancelled');
  if (!code || !state || !expected || state !== expected) {
    return failed(c, 'expired');
  }

  const tokenRes = await fetch(`${HCA}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(c.req.url),
      client_id: c.env.HACKCLUB_CLIENT_ID,
      client_secret: c.env.HACKCLUB_CLIENT_SECRET,
    }),
  });
  if (!tokenRes.ok) {
    console.error('hca token exchange failed', tokenRes.status, await tokenRes.text());
    return failed(c, 'failed');
  }
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) return failed(c, 'failed');

  const infoRes = await fetch(`${HCA}/oauth/userinfo`, {
    headers: { authorization: `Bearer ${access_token}`, accept: 'application/json' },
  });
  if (!infoRes.ok) {
    console.error('hca userinfo failed', infoRes.status, await infoRes.text());
    return failed(c, 'failed');
  }
  const info = (await infoRes.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };

  if (!info.email || info.email_verified === false) {
    return failed(c, 'no_email');
  }
  // sub is the account id every row is filed under; without it there is no
  // account to open.
  if (!info.sub) return failed(c, 'failed');
  if (!isAllowed(c.env, info.email)) {
    return failed(c, 'not_allowed');
  }

  await recordAccount(c.env, info.sub, info.email, info.name ?? null);

  const user: SessionUser = {
    email: info.email,
    name: info.name ?? null,
    sub: info.sub,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  await setSignedCookie(c, SESSION_COOKIE, JSON.stringify(user), secret, {
    path: '/',
    httpOnly: true,
    secure: secure(c.req.url),
    sameSite: 'Lax',
    maxAge: SESSION_TTL_SECONDS,
  });
  return c.redirect('/');
});

/**
 * Upserts the account row, which is what lets an agent key keep working: ingest
 * checks the key's account email against the allowlist.
 *
 * The owner's sign-in also claims everything recorded before accounts existed,
 * which sits under DEV_ACCOUNT. Every later sign-in finds nothing left to move.
 * OR IGNORE, so a name clash can never block a login; the clashing row is
 * simply left where it was.
 */
async function recordAccount(env: Env, sub: string, email: string, name: string | null) {
  const now = Math.floor(Date.now() / 1000);
  const stmts = [
    env.DB.prepare(
      `INSERT INTO accounts (id, email, name, created_at, last_login) VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT (id) DO UPDATE SET email = ?2, name = ?3, last_login = ?4`,
    ).bind(sub, email, name, now),
  ];
  if (isOwner(env, email)) {
    for (const table of ['api_keys', 'projects', 'trees']) {
      stmts.push(
        env.DB.prepare(`UPDATE OR IGNORE ${table} SET account_id = ?1 WHERE account_id = ?2`).bind(
          sub,
          DEV_ACCOUNT,
        ),
      );
    }
  }
  await env.DB.batch(stmts);
}

oauth.get('/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: secure(c.req.url) });
  return c.redirect('/');
});

/** Who the dashboard is signed in as. `auth: false` means the gate is off (local dev). */
oauth.get('/auth/me', async (c) => {
  if (!authOn(c.env)) return c.json({ auth: false, user: null });
  const user = await sessionUser(c);
  return c.json({ auth: true, user: user && { email: user.email, name: user.name } });
});
