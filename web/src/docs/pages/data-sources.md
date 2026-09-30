# Data sources

The snapshot CLI and Hackatime are separate pipelines. The **Data source** filter shows either one on its own, which is the fastest way to tell which of them is misbehaving.

| Option | Shows |
|---|---|
| All sources | Everything |
| Snapshot CLI only | Panels built from snapshots this server received |
| Hackatime only | Panels built from hackatime.hackclub.com |

The choice is saved in this browser, so a debugging view survives a reload.

## Source tags

Every panel is labelled:

- **Snapshot CLI**, in blue: from `snapshot-agent` on your machines.
- **Hackatime**, in orange: from Hackatime's editor plugins.

The colours match the two series on the daily time charts.

## Checking each pipeline

[Settings](#/settings) has a status card for each.

**Snapshot CLI** shows how many projects the server knows, when the last snapshot arrived (and how long after capture, if it was queued) and which agent versions have reported.

**Hackatime** shows how the server reads your stats and whether it succeeded:

| Status | Meaning |
|---|---|
| Connected | Stats were read |
| No matching account | Hackatime has no account for your Hack Club sign-in |
| Private | Your Hackatime stats are private |
| Key rejected | The server's Hackatime key is wrong |
| Unavailable | Hackatime could not be reached; changing the date range retries |

See [Hackatime](#/docs/hackatime) for how to fix each.
