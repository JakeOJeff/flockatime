import { Hono } from 'hono';
import type { Env } from './types';
import { ingest } from './ingest';
import { api } from './api';
import { oauth } from './oauth';
import { hackatime } from './hackatime';
import { keys } from './keys';
import { install } from './install';

const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.json({ ok: true }));

app.route('/', ingest);
app.route('/', api);
app.route('/', oauth);
app.route('/', hackatime);
app.route('/', keys);
app.route('/', install);

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
