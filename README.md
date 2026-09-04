# flockatime

Collection server and dashboard for [`snapshot-agent`](../flockatime-cli) — the Go
CLI that records the *shape* of a project tree (path hashes, content hashes, line
counts) and never its contents.

Single Cloudflare Worker: it serves the ingest API, the dashboard API, and the
built frontend from one origin, so there is no CORS layer and one `deploy`.
D1 is the only storage binding — there is no R2 bucket to create and no payment
method to add.

```
src/          Worker — Hono routes
  ingest.ts     POST /v1/snapshots   (the agent writes here)
  api.ts        GET  /api/*          (the dashboard reads here)
  trees.ts      file-list packing + diffing
  auth.ts       bearer keys, Access gate
migrations/   D1 schema
web/          Vite + React dashboard, built to web/dist
scripts/      key minting
```

## How the data is stored

The agent re-sends the **entire file list** whenever the tree hash moves — it does
not diff. Storing a row per file per tick would reach millions of rows in a week
for data nobody queries per-file, so:

- **File lists are deduped by `tree_hash`.** The hash is derived from the list, so
  an identical hash is an identical list: it is gzipped into that tree's row
  once, and every later snapshot points at it.
- **The diff runs at ingest,** while both lists are already in memory. The
  added / removed / modified / lines-delta summary is written onto the snapshot
  row, so **no dashboard query unpacks a file list** on a normal page load.
- The one exception is `/api/projects/:name/churn`, which reads stored lists back
  to rank per-file volatility. It is capped at 200 trees per request.

Two consequences of the agent's design are handled explicitly:

- The offline queue replays a batch whose response was lost, so ingest is
  idempotent via `UNIQUE (project_id, captured_at, tree_hash)` + `INSERT OR IGNORE`.
- `captured_at` is a client clock and can be wrong. `received_at` is recorded
  alongside it.

A malformed record inside a batch is dropped rather than rejected: any non-2xx
makes the agent re-queue the whole batch, so a 400 would wedge it into retrying a
poison record forever.

## Local development

```bash
npm install
npm run build                 # frontend → web/dist
npx wrangler d1 migrations apply flockatime --local
node scripts/new-key.mjs "laptop" > key.sql   # token → stderr, SQL → stdout
npx wrangler d1 execute flockatime --local --file=./key.sql && rm key.sql
npm run dev                   # http://127.0.0.1:8787
```

Point the agent at it — this is the port the CLI's own `devserver` used, so an
existing `agent.toml` needs only the key changed:

```toml
endpoint = "http://127.0.0.1:8787"
api_key  = "flk_..."          # from new-key.mjs
interval_seconds = 2
```

Then `snapshot-agent run`, and the dashboard fills in.

For frontend work with hot reload, run `npm run dev` and `npm run dev:web` side by
side; Vite proxies `/api` and `/v1` to the Worker.

## Deploying

```bash
npx wrangler d1 create flockatime          # put the id in wrangler.jsonc
npx wrangler d1 migrations apply flockatime --remote
node scripts/new-key.mjs "laptop" > key.sql
npx wrangler d1 execute flockatime --remote --file=./key.sql && rm key.sql
npm run deploy
```

Then set `agent.toml`'s `endpoint` to the deployed URL.

### Dashboard auth

The ingest route is authenticated by bearer key. The dashboard is not, until you
put **Cloudflare Access** in front of it and flip `REQUIRE_ACCESS` to `"true"` in
`wrangler.jsonc` — then `/api/*` refuses anything that did not arrive through
Access. Leave `/v1/*` out of the Access policy, or the agent will be redirected to
a login page.

`REQUIRE_ACCESS` defaults to `"false"` so `wrangler dev` works without it. **Do not
deploy to a public hostname while it is `"false"`.**

## Known limits

- A late queue flush that lands *before* rows already stored gets a correct diff
  itself, but the row that follows it keeps its original, now-stale summary. It is
  not recomputed.
- Daily roll-ups group by UTC day. Store a local-day column if the heatmap ever
  needs the viewer's timezone.
- Single-user: every row uses `account_id = 'local'`. The column is carried
  everywhere so multi-tenant needs no migration.
- Storing the file lists in D1 rather than R2 buys a free deployment and costs a
  ceiling: a D1 database caps at **500 MB** on the free plan and 10 GB paid,
  where R2 gives 10 GB free. A list costs roughly 100 bytes per file per distinct
  tree, so a 1,000-file project is ~100 KB per tree hash — fine for a demo or a
  single developer, and the point at which to move the blobs back out to R2 (or
  prune old trees) if this ever grows past one person.

<!-- repro touch -->
