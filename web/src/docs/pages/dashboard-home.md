# Home

The Home page is your coding at a glance: totals from the snapshot CLI, editor time from Hackatime, and the projects the agent is watching.

## Filters

Two filters sit above the charts and apply across the dashboard.

- **Date range**: the last 24 hours, 7, 30 or 90 days, the last year, or all time (the default).
- **Data source**: all sources, the snapshot CLI only, or Hackatime only. The choice is remembered in this browser. See [Data sources](#/docs/data-sources).

## Snapshot CLI tiles

When the snapshot CLI is shown and has sent something, a row of totals across every project leads the page:

| Tile | Meaning |
|---|---|
| Snapshot CLI time | Active time summed over every project, and how many were active |
| Lines written | Lines added, with lines removed, in the range |
| Saves | File saves between snapshots |
| Builds · tests | Times build output and test caches were touched |
| Uncommitted | Uncommitted lines across every repository right now, and how many are dirty |
| History chain | Whether every snapshot links up, across all projects |

## Hackatime tiles

| Tile | Meaning |
|---|---|
| Total time | Hackatime editor time in the window |
| Top project | The Hackatime project with the most time |
| Top language | The language with the most time |
| Top OS | The operating system with the most time |
| Top editor | The editor with the most time |
| Top category | Hackatime's activity category, such as coding or debugging |

## Charts

- **Project durations**: the top ten Hackatime projects, ranked.
- **Languages**, **Editors**, **Operating systems**: share of editor time. Hover a slice or legend row for its exact time.
- **Coding time per day**: daily Hackatime totals, with the average for the window. Past 90 days the chart shows the last 90.

Every panel carries a small tag, **Hackatime** or **Snapshot CLI**, naming where its numbers come from.

## Snapshotted by flockatime

The list of projects the agent has sent, with their active time, lines added and removed and saves in the range, their current line count and the time of the last snapshot. Click one to open its [project page](#/docs/dashboard-projects).

If the list says **No projects yet**, the agent has not sent anything for your account. Head to [Extensions](#/extensions) or read [Troubleshooting](#/docs/troubleshooting).
