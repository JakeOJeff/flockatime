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
  auth.ts       bearer keys, dashboard session gate
  oauth.ts      GET  /auth/*         (Hack Club Auth sign-in)
  hackatime.ts  GET  /api/hackatime  (Hackatime stats proxy)
  keys.ts       /api/keys            (mint / list / revoke agent keys)
  install.ts    GET  /install.ps1, /install.sh  (one-line CLI installers)
migrations/   D1 schema
web/          Vite + React dashboard, built to web/dist
  src/docs/     the Docs page: one Markdown file per page in pages/,
                sidebar order in content.ts
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

The ingest route is authenticated by bearer key. The dashboard signs in with
[Hack Club Auth](https://auth.hackclub.com): `/auth/login` runs the OAuth code
flow, reads the email from `/oauth/userinfo`, and sets an HMAC-signed session
cookie for seven days. Only emails in `ALLOWED_EMAILS` get in — full addresses, or
`@domain` entries such as `@hackclub.com` that admit exactly that domain (not its
subdomains). An empty list lets nobody in, and removing an entry locks it out on
its next request — dashboard and agents alike.

#### Accounts

Every signed-in user has their own account, keyed by their Hack Club Auth id:
their own agent keys (devices), projects, snapshots and file lists. Nothing is
shared. A user sees and revokes only the keys they minted, and a key writes only
into the account that minted it; a project name or tree hash that matches
someone else's stays separate. Ingest checks the key's account against
`ALLOWED_EMAILS` on every request, so a removed user's agents stop too.

`OWNER_EMAIL` is the deployment owner. Data recorded before accounts existed sits
under `account_id = 'local'`, and the owner's first sign-in moves it — keys
included, so their running agents keep working — into their account. Until
then those agents get a 401 and queue their snapshots, and they flush once the
owner has signed in.

1. Create an app at <https://auth.hackclub.com/developer/apps> with the redirect
   URI `https://<your-worker>/auth/callback` and scopes `openid email name`.
2. Put the client ID and your email in `wrangler.jsonc` (`HACKCLUB_CLIENT_ID`,
   `ALLOWED_EMAILS`, `OWNER_EMAIL`).
3. Set the two secrets:
   ```bash
   npx wrangler secret put HACKCLUB_CLIENT_SECRET
   npx wrangler secret put SESSION_SECRET     # any long random string
   ```
4. `npm run deploy`.

`REQUIRE_AUTH` is `"true"` in `wrangler.jsonc` and set to `false` in `.dev.vars`
so `wrangler dev` works without an OAuth app. To test sign-in locally, add
`http://127.0.0.1:8787/auth/callback` to the app and put `REQUIRE_AUTH=true` plus
the three settings above in `.dev.vars`.

### Hackatime

The dashboard shows editor time from [Hackatime](https://hackatime.hackclub.com)
beside tree activity. The Worker proxies it, so no key reaches the browser. For
the owner (`OWNER_EMAIL`) it picks who to ask for in this order:

1. `HACKATIME_API_KEY` secret — your own key (Hackatime → Settings), reads your
   stats even when they are private:
   ```bash
   npx wrangler secret put HACKATIME_API_KEY
   ```
2. `HACKATIME_USER` in `wrangler.jsonc` — a username or Slack ID; public stats only.
3. The signed-in Hack Club Auth id — Hackatime can look users up by it; public
   stats only.

Every other user always gets 3, their own public stats: the first two describe
the owner and are never used for anyone else.

Hackatime time is account-wide (every project), and the panel matches a
Hackatime project to the open flockatime project by name.

### Installing the CLI

The dashboard's **Extensions** page mints a key and shows one command:

```
$env:FLOCKATIME_KEY='flk_...'; irm https://<worker>/install.ps1 | iex        # Windows
curl -fsSL https://<worker>/install.sh | FLOCKATIME_KEY=flk_... sh           # macOS / Linux
```

The Worker serves both scripts with its own origin filled in as the endpoint.
They download the latest [`CLI_REPO`](wrangler.jsonc) release, verify it against
`SHA256SUMS`, and run `snapshot-agent setup`, which enables the WakaTime debug
log and starts the agent at login. From then on it follows Hackatime: projects
appear here as you edit them, with no list to maintain. The scripts need a
published release in `CLI_REPO` (push a `v*` tag there).

Keys can be revoked under **Settings**. `scripts/new-key.mjs` still works for
minting one from the terminal.

## Known limits

- A late queue flush that lands *before* rows already stored gets a correct diff
  itself, but the row that follows it keeps its original, now-stale summary. It is
  not recomputed.
- Daily roll-ups and the weekly heatmap are cut in the viewer's current UTC offset,
  so days that crossed a DST change can be off by an hour at the edges.
- With `REQUIRE_AUTH` off (local dev) there are no accounts: everything is filed
  under `account_id = 'local'`.
- Storing the file lists in D1 rather than R2 buys a free deployment and costs a
  ceiling: a D1 database caps at **500 MB** on the free plan and 10 GB paid,
  where R2 gives 10 GB free. A list costs roughly 100 bytes per file per distinct
  tree, so a 1,000-file project is ~100 KB per tree hash — fine for a demo or a
  single developer, and the point at which to move the blobs back out to R2 (or
  prune old trees) if this ever grows past one person.

<!-- repro touch -->
