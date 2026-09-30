# Projects

Each project page shows what your time did to the code: how the tree grew, where it churned, and when.

The page refreshes itself every ten seconds while it is open, so a snapshot shows up shortly after the agent sends it.

## Tiles

| Tile | Meaning |
|---|---|
| Lines | Total lines in the latest snapshot, with the file count |
| Active time | How long the tree was actually moving, with the number of sessions and the longest |
| Hackatime | Editor time Hackatime recorded for a project with the same name |
| Net lines | Lines added minus lines removed in the window |
| Branch | Current branch, short commit SHA, clean or dirty, and commits ahead of upstream |
| Files changed | Files added, removed and modified in the window |
| Snapshots | Snapshots received, and how many had changes |
| Commits worked on | Distinct HEAD commits seen, across how many branches |

## Active time vs editor time

**Active time** comes from the snapshots. They are grouped into *sessions*: runs of snapshots whose tree changed, split wherever two captures are more than 15 minutes apart. A session's length is from its first change to its last.

**Editor time** comes from Hackatime heartbeats. It counts reading and navigating too, so it is usually higher than active time. Neither is wrong: together they tell you how much of your time turned into changes.

## Charts

- **Coding time per day**: active time per day, beside Hackatime's daily editor total. Hackatime's daily numbers are account-wide, not per project.
- **Total lines**: every snapshot in the window, plotted on the agent's clock.
- **Daily churn**: lines added above the axis, lines removed below.
- **Weekly rhythm**: when the tree moves, by weekday and hour, in your time zone.

## Sessions

Each coding session in the window with its start, length, snapshot count, lines added and removed, and files touched.

## Work per commit

Snapshots grouped by the commit that was HEAD when they were taken. The span is how long you sat on that commit; the deltas are the work you did on top of it. A red dot marks a commit whose tree was dirty at some point.

## Most-revised files

Files ranked by **net lines moved** across revisions, with the revision count as a tie-break. A file rewritten once outranks one saved twenty times without changing size.

The names are path hashes, because the server never sees a path. Map one back with `snapshot-agent once` in the repository.

> **Note:** lines moved counts the change in a file's line count per revision. An edit that replaces a line without changing the count reads as zero. True line-level churn would need data the agent deliberately does not send.

## Hackatime projects

On the projects list, a table shows every Hackatime project in the window, its editor time and share, and whether the agent reports a project with the same name. A mismatch usually means the names differ; see [Hackatime](#/docs/hackatime#matching-projects).
