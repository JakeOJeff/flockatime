# Authentication

The dashboard signs in with [Hack Club Auth](https://auth.hackclub.com). Agents authenticate with bearer keys.

## Setting up sign-in

1. Create an app at [auth.hackclub.com/developer/apps](https://auth.hackclub.com/developer/apps).
2. Set the redirect URI to `https://<your-host>/auth/callback`.
3. Request the scopes `openid email name`.
4. Put the client ID in `HACKCLUB_CLIENT_ID`, and the client secret in the `HACKCLUB_CLIENT_SECRET` secret.

## The sign-in flow

1. `/auth/login` sets a short-lived signed `state` cookie and redirects to Hack Club Auth.
2. Hack Club Auth redirects back to `/auth/callback` with a code.
3. The Worker exchanges the code server-side, reads your identity from `/oauth/userinfo`, and checks your email against `ALLOWED_EMAILS`.
4. It sets an HMAC-signed session cookie that lasts **seven days**.

The allowlist is checked again on every request, so removing someone locks them out at once rather than when their cookie expires.

## Who can sign in

`ALLOWED_EMAILS` is a comma-separated list of:

- full addresses, such as `you@example.com`,
- `@domain` entries, such as `@hackclub.com`, which admit exactly that domain.

A domain entry does not admit subdomains or look-alikes: `@hackclub.com` lets in neither `x@sub.hackclub.com` nor `x@evil-hackclub.com`. An empty list lets nobody in.

Removing an account from the list stops its agents as well as its dashboard.

## Sign-in errors

| Message | Cause |
|---|---|
| not configured | `HACKCLUB_CLIENT_ID`, `HACKCLUB_CLIENT_SECRET` or `SESSION_SECRET` is missing |
| cancelled | You declined on the Hack Club Auth screen |
| expired | The sign-in took over ten minutes, or the state cookie was lost. Try again |
| no email | Hack Club Auth returned no verified email |
| not allowed | Your email is not in `ALLOWED_EMAILS` |
| failed | The token exchange or userinfo request failed |

## Accounts and the owner

Each person gets an account keyed by their Hack Club Auth id. Keys, projects, snapshots and file lists all belong to one account.

`OWNER_EMAIL` names the deployment owner. The owner:

- is the only account that uses `HACKATIME_API_KEY` and `HACKATIME_USER`,
- on first sign-in, claims data recorded before accounts existed, including its keys, so running agents keep working.

## Turning auth off locally

`REQUIRE_AUTH` is `"true"` in production. Set `REQUIRE_AUTH=false` in `.dev.vars` to run `wrangler dev` without an OAuth app. Everything is then filed under a single `local` account.

The check fails closed: only the exact string `false` turns auth off, so a missing or mistyped value keeps it on.
