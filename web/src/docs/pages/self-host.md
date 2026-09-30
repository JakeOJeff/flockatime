# Deploy your own

flockatime is one Cloudflare Worker and one D1 database. It runs on Cloudflare's free plan, with no R2 bucket and no payment method.

## What you need

- A Cloudflare account and `npx wrangler login`
- Node.js 20 or newer
- A Hack Club Auth app, for sign-in ([Authentication](#/docs/auth))

## 1. Clone and install

```sh
git clone https://github.com/JakeOJeff/flockatime.git
cd flockatime
npm install
```

## 2. Create the database

```sh
npx wrangler d1 create flockatime
```

Put the printed `database_id` into `wrangler.jsonc`, then apply the schema:

```sh
npx wrangler d1 migrations apply flockatime --remote
```

## 3. Configure

In `wrangler.jsonc`:

- set `routes` to your own hostname, or remove it to use the `workers.dev` URL,
- set `HACKCLUB_CLIENT_ID`, `ALLOWED_EMAILS` and `OWNER_EMAIL`.

Then the secrets:

```sh
npx wrangler secret put HACKCLUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET     # any long random string
```

Every setting is listed in [Environment reference](#/docs/env).

## 4. Deploy

```sh
npm run deploy
```

This builds the dashboard into `web/dist` and deploys the Worker, which serves the API, the dashboard and the install scripts from one origin.

## 5. Connect a machine

Sign in, open **Extensions** and run the install command. The Worker fills its own origin into the scripts, so they point at your server with no editing.

The scripts download `snapshot-agent` from the GitHub repository in `CLI_REPO`. To ship your own builds, point it at your fork and push a `v*` tag there; the release workflow publishes the archives and `SHA256SUMS` the scripts expect.

## Minting a key from the terminal

Keys normally come from the dashboard. For scripting, or before sign-in works:

```sh
node scripts/new-key.mjs "laptop" > key.sql   # token on stderr, SQL on stdout
npx wrangler d1 execute flockatime --remote --file=./key.sql && rm key.sql
```

## Storage limits

File lists live in D1, which caps a database at **500 MB** on the free plan and 10 GB paid. A stored list costs roughly 100 bytes per file per distinct tree, so a 1,000-file project uses about 100 KB each time its tree changes. That is comfortable for a few people. For much more, move the file lists out to R2 or prune old trees.
