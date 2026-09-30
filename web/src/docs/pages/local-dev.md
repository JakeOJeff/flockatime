# Local development

Run the Worker, the dashboard and an agent entirely on your machine.

## Start the server

```sh
npm install
npm run build
npm run migrate:local
npm run dev                  # http://127.0.0.1:8787
```

Create `.dev.vars` with `REQUIRE_AUTH=false` so you do not need an OAuth app locally.

## Mint a key

```sh
node scripts/new-key.mjs "laptop" > key.sql
npx wrangler d1 execute flockatime --local --file=./key.sql && rm key.sql
```

The token is printed to stderr. Only its hash goes into the SQL.

## Point an agent at it

Write a separate config so your real one is untouched:

```toml
# loop.toml
endpoint = "http://127.0.0.1:8787"
api_key  = "flk_..."
interval_seconds = 2
queue_path = "./loop-queue.db"

[[project]]
name = "demo"
path = "~/src/some-project"
```

Plain `http://` is allowed because it is localhost. Then:

```sh
SNAPSHOT_AGENT_CONFIG=./loop.toml snapshot-agent run
```

On Windows:

```powershell
$env:SNAPSHOT_AGENT_CONFIG = "./loop.toml"; snapshot-agent run
```

## Hot reload

For dashboard work, run the Worker and Vite side by side:

```sh
npm run dev          # Worker on :8787
npm run dev:web      # Vite, proxies /api and /v1 to the Worker
```

## Testing sign-in locally

Add `http://127.0.0.1:8787/auth/callback` as a redirect URI on your Hack Club Auth app, then put these in `.dev.vars`:

```ini
REQUIRE_AUTH=true
HACKCLUB_CLIENT_SECRET=...
SESSION_SECRET=...
```

## Scripts

| Script | Does |
|---|---|
| `npm run dev` | Worker with local D1 |
| `npm run dev:web` | Vite dev server with HMR |
| `npm run build` | Builds the dashboard to `web/dist` |
| `npm run deploy` | Build, then `wrangler deploy` |
| `npm run migrate:local` | Apply migrations to local D1 |
| `npm run migrate:remote` | Apply migrations to production D1 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run key:new` | Mint an agent key |
