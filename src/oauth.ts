import { Hono } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { Env } from './types';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, isAllowed, sessionUser, type SessionUser } from './auth';

/**
 * Dashboard login via Hack Club Auth (OAuth 2.0 authorization code flow).
 * The code is exchanged server-side and the identity read from userinfo over
 * TLS, so there is no ID token to verify and no JWKS to fetch.
 */
const HCA = 'https://auth.hackclub.com';
const SCOPES = 'openid email name';
const STATE_COOKIE = 'fk_oauth_state';

type Ctx = { Bindings: Env };

export const oauth = new Hono<Ctx>();

const redirectUri = (url: string) => new URL('/auth/callback', url).toString();
const secure = (url: string) => new URL(url).protocol === 'https:';

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

oauth.get('/auth/login', async (c) => {
  if (!c.env.HACKCLUB_CLIENT_ID || !c.env.SESSION_SECRET) {
    return c.text('Hack Club Auth is not configured on this server.', 500);
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
    return c.text('Hack Club Auth is not configured on this server.', 500);
  }

  const expected = await getSignedCookie(c, secret, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: '/auth', secure: secure(c.req.url) });

  const { code, state, error } = c.req.query();
  if (error) return c.text(`Sign-in was cancelled or refused: ${error}`, 400);
  if (!code || !state || !expected || state !== expected) {
    return c.text('Sign-in expired or was tampered with. Go back and try again.', 400);
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
    return c.text('Could not complete sign-in with Hack Club.', 502);
  }
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) return c.text('Could not complete sign-in with Hack Club.', 502);

  const infoRes = await fetch(`${HCA}/oauth/userinfo`, {
    headers: { authorization: `Bearer ${access_token}`, accept: 'application/json' },
  });
  if (!infoRes.ok) {
    console.error('hca userinfo failed', infoRes.status, await infoRes.text());
    return c.text('Could not read your Hack Club profile.', 502);
  }
  const info = (await infoRes.json()) as { email?: string; email_verified?: boolean; name?: string };

  if (!info.email || info.email_verified === false) {
    return c.text('Your Hack Club account has no verified email.', 403);
  }
  if (!isAllowed(c.env, info.email)) {
    return c.text(`${info.email} is not allowed to view this dashboard.`, 403);
  }

  const user: SessionUser = {
    email: info.email,
    name: info.name ?? null,
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

oauth.get('/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: secure(c.req.url) });
  return c.redirect('/');
});

/** Who the dashboard is signed in as. `auth: false` means the gate is off (local dev). */
oauth.get('/auth/me', async (c) => {
  if (c.env.REQUIRE_AUTH !== 'true') return c.json({ auth: false, user: null });
  const user = await sessionUser(c);
  return c.json({ auth: true, user: user && { email: user.email, name: user.name } });
});
