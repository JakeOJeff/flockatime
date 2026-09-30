import { Hono } from 'hono';
import type { Env } from './types';
import { ingest } from './ingest';
import { api } from './api';
import { oauth } from './oauth';

const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.json({ ok: true }));

app.route('/', ingest);
app.route('/', api);
app.route('/', oauth);

// wrangler.jsonc routes only /v1/*, /api/* and /auth/* through the Worker, so this is a
// safety net: anything else that still lands here is a static asset request.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((err, c) => {
  console.error('unhandled', err);
  // 500 is deliberate on ingest: the agent re-queues and retries, so a
  // transient failure here loses nothing.
  return c.json({ error: 'internal error' }, 500);
});

export default app;
