# Data sources

The snapshot CLI and Hackatime are separate pipelines. The dashboard shows them side by side, always in the same colours:

- **Snapshot CLI**, in blue: from `snapshot-agent` on your machines.
- **Hackatime**, in red: from Hackatime's editor plugins.

## Showing one source

A project page has a **Data source** filter that shows either one on its own, which is the fastest way to tell which of them is misbehaving.

| Option | Shows |
|---|---|
| All sources | Everything |
| Snapshot CLI only | Panels built from snapshots this server received |
| Hackatime only | Panels built from hackatime.hackclub.com |

The choice is saved in this browser, so a debugging view survives a reload.

## Checking each pipeline

[Settings](#/settings) has a card for each.

**Snapshot CLI** shows how many projects and snapshots the server holds, and when and from which project the last one arrived.

**Your machines** lists every live agent key, one per install: its platform and agent version, snapshots per day over the last 30 days, how many repos it reports and when it was last heard. An agent older than the newest one reporting is flagged *update*, and a key that has never been used can be revoked from the strip below. Snapshots sent before the server recorded keys on them count for no machine.

**Hackatime** shows whether the server could read your stats and how:

| Status | Meaning |
|---|---|
| Connected | Stats were read |
| No matching account | Hackatime has no account for your Hack Club sign-in |
| Private | Your Hackatime stats are private |
| Key rejected | The server's Hackatime key is wrong |
| Unavailable | Hackatime could not be reached; changing the date range retries |

See [Hackatime](#/docs/hackatime) for how to fix each.
