import { Hono } from 'hono';
import type { AppEnv } from './types';
import { ingest } from './ingest';
import { api } from './api';
import { oauth } from './oauth';
import { hackatime } from './hackatime';
import { keys } from './keys';
import { install } from './install';
import { admin } from './admin';

const app = new Hono<AppEnv>();

app.get('/healthz', (c) => c.json({ ok: true }));

// Everything under /api and /auth answers for one signed-in account, so no
// browser or proxy cache may hand it to the next person on that machine.
for (const path of ['/api/*', '/auth/*']) {
  app.use(path, async (c, next) => {
    await next();
    c.header('cache-control', 'private, no-store');
  });
}

app.route('/', ingest);
app.route('/', api);
app.route('/', oauth);
app.route('/', hackatime);
app.route('/', keys);
app.route('/', install);
app.route('/', admin);

// wrangler.jsonc runs the Worker first only for its own routes (run_worker_first), so this is a
// safety net: anything else that still lands here is a static asset request.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((err, c) => {
  console.error('unhandled', err);
  // 500 is deliberate on ingest: the agent re-queues and retries, so a
  // transient failure here loses nothing.
  return c.json({ error: 'internal error' }, 500);
});

export default app;
