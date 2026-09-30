import { Hono } from 'hono';
import type { AppEnv } from './types';
import { isOwner, requireDashboard, sessionUser } from './auth';
import { tzOffsetMinutes } from './api';

/**
 * Hackatime (hackatime.hackclub.com) editor-time stats, proxied so the browser
 * never holds the API key and the dashboard can lay them beside tree activity.
 *
 * Who to ask for, in order:
 *   1. HACKATIME_API_KEY (secret) — the owner's own key, reads `users/my`,
 *      works even when their stats are private.
 *   2. HACKATIME_USER — the owner's username or Slack ID; needs public stats.
 *   3. The signed-in Hack Club Auth id — Hackatime looks users up by it too;
 *      needs public stats.
 *
 * 1 and 2 describe one person, so they apply only to OWNER_EMAIL (or to
 * everyone while auth is off in local dev). Every other user gets 3: their
 * own public stats, never the owner's.
 */
const HT = 'https://hackatime.hackclub.com/api/v1';

export const hackatime = new Hono<AppEnv>();

hackatime.use('/api/hackatime', requireDashboard);

interface Slice {
  name: string;
  total_seconds: number;
  percent: number;
}

interface HtStats {
  data: {
    username?: string;
    total_seconds?: number;
    daily_average?: number;
    streak?: number;
    languages?: Slice[];
    projects?: Slice[];
    editors?: Slice[];
    operating_systems?: Slice[];
    categories?: Slice[];
  };
}

interface Span {
  start_time: number;
  end_time: number;
  duration: number;
}

const slim = (rows: Slice[] | undefined) =>
  (rows ?? [])
    .filter((r) => r.total_seconds > 0)
    .map(({ name, total_seconds, percent }) => ({ name, total_seconds, percent }));

hackatime.get('/api/hackatime', async (c) => {
  const session = c.env.REQUIRE_AUTH === 'true' ? await sessionUser(c) : null;
  const owner = c.env.REQUIRE_AUTH !== 'true' || isOwner(c.env, session?.email);
  const key = owner ? c.env.HACKATIME_API_KEY : undefined;
  const user = owner ? c.env.HACKATIME_USER : undefined;
  const who = key ? 'my' : user || session?.sub;
  if (!who) return c.json({ configured: false });
  const source = key ? 'api_key' : user ? 'username' : 'hack_club';

  const days = Math.min(Math.max(Number(c.req.query('days') ?? 7) || 7, 1), 365);
  const tz = tzOffsetMinutes(c);
  const now = Math.floor(Date.now() / 1000);
  const from = now - days * 86400;
  const range = new URLSearchParams({
    start_date: new Date(from * 1000).toISOString(),
    end_date: new Date(now * 1000).toISOString(),
  });
  const headers: HeadersInit = { accept: 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  const base = `${HT}/users/${encodeURIComponent(who)}`;

  const [statsRes, spansRes] = await Promise.all([
    fetch(`${base}/stats?features=languages,projects,editors,operating_systems,categories&${range}`, { headers }),
    fetch(`${base}/heartbeats/spans?${range}`, { headers }),
  ]);

  if (!statsRes.ok || !spansRes.ok) {
    const status = !statsRes.ok ? statsRes.status : spansRes.status;
    const error =
      status === 404
        ? 'not_found'
        : status === 403
          ? 'private'
          : status === 401
            ? 'bad_key'
            : 'unavailable';
    return c.json({ configured: true, source, error });
  }

  const stats = ((await statsRes.json()) as HtStats).data;
  const { spans } = (await spansRes.json()) as { spans: Span[] };

  // Bucket span time by the viewer's local day and hour, splitting any span
  // that crosses an hour boundary so a long stretch lands where it happened.
  const daily = new Map<string, number>();
  const hours = new Array<number>(24).fill(0);
  for (const s of spans ?? []) {
    let t = Math.max(s.start_time, from);
    const end = Math.min(s.end_time, now);
    while (t < end) {
      const next = Math.min(end, (Math.floor((t + tz * 60) / 3600) + 1) * 3600 - tz * 60);
      const local = new Date((t + tz * 60) * 1000);
      const day = local.toISOString().slice(0, 10);
      daily.set(day, (daily.get(day) ?? 0) + (next - t));
      hours[local.getUTCHours()] += next - t;
      t = next;
    }
  }

  return c.json({
    configured: true,
    source,
    username: stats.username ?? null,
    total_seconds: stats.total_seconds ?? 0,
    daily_average: stats.daily_average ?? 0,
    streak: stats.streak ?? 0,
    languages: slim(stats.languages),
    projects: slim(stats.projects),
    editors: slim(stats.editors),
    operating_systems: slim(stats.operating_systems),
    categories: slim(stats.categories),
    daily: [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, seconds]) => ({ day, seconds: Math.round(seconds) })),
    hours: hours.map(Math.round),
  });
});
