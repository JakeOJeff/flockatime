# Environment reference

Plain settings go in `vars` in `wrangler.jsonc`. Secrets are set with `npx wrangler secret put NAME`.

## Variables

| Name | Default | Meaning |
|---|---|---|
| `REQUIRE_AUTH` | `"true"` | Sign-in required for `/api/*`. Only `"false"` turns it off |
| `ALLOWED_EMAILS` | | Comma-separated addresses and `@domain` entries allowed in. Empty lets nobody in |
| `OWNER_EMAIL` | | The deployment owner. See [Authentication](#/docs/auth#accounts-and-the-owner) |
| `HACKCLUB_CLIENT_ID` | | Hack Club Auth app client ID. Not secret |
| `HACKATIME_USER` | `""` | Owner's Hackatime username or Slack ID. Public stats only |
| `SESSION_GAP_SECONDS` | `"900"` | Gap between snapshots that ends a coding session |
| `CLI_REPO` | `JakeOJeff/flockatime-cli` | GitHub `owner/repo` the install scripts download from |

## Secrets

| Name | Required | Meaning |
|---|---|---|
| `HACKCLUB_CLIENT_SECRET` | Yes | Hack Club Auth app client secret |
| `SESSION_SECRET` | Yes | Signs session and state cookies. Any long random string |
| `HACKATIME_API_KEY` | No | Owner's Hackatime key. Reads private stats |

## Bindings

| Binding | Type | Meaning |
|---|---|---|
| `DB` | D1 | Accounts, keys, projects, snapshots and file lists |
| `ASSETS` | Static assets | The built dashboard in `web/dist` |

## Routes the Worker owns

The Worker runs before static assets only for its own routes, so the dashboard's single-page fallback can never swallow an API call:

```text
/v1/*   /api/*   /auth/*   /healthz   /install.ps1   /install.sh
```

Everything else is served from `web/dist`.
