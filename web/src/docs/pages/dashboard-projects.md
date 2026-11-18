# Projects

Each project page shows what your time did to the code: how the tree grew, where it churned, when you saved, and whether the record is complete.

The page refreshes itself every ten seconds while it is open, so a snapshot shows up shortly after the agent sends it.

Panels marked "needs agent 0.3" fill in once the machine runs snapshot-agent 0.3 or later. Agents update themselves, so this usually happens on its own. See [What the agent records](#/docs/cli-signals).

## The projects list

Each card shows the snapshot CLI's active time beside Hackatime's editor time for the selected range, the line and file count, the branch, lines added and removed, saves and builds in the range. Small flags call out what needs attention:

| Flag | Meaning |
|---|---|
| conflict | Files are in a merge conflict |
| N uncommitted | Lines changed against HEAD but not committed |
| N behind | Commits behind the upstream branch |
| N chain breaks | Snapshots missing, forked or restarted in the range |
| agent X.Y.Z | This project's agent is older than the newest one reporting to your account |

## Tiles

| Tile | Meaning |
|---|---|
| Lines | Total lines in the latest snapshot, with the file count and repo size |
| Active time | How long the tree was actually moving, with the number of sessions and the longest |
| Hackatime | Editor time Hackatime recorded for a project with the same name |
| Lines written | Net lines, with lines added and removed. Marked *net estimate* when the window predates per-line diffs |
| Saves | File saves between snapshots, and how many per active hour |
| Branch | Current branch, short commit SHA, clean or dirty, commits ahead (↑) and behind (↓) |
| Commits made | How much git's commit count grew in the window, with the last commit's time |
| Builds · tests | Distinct times build output and test caches were touched |
| Files changed | Files added, removed and modified in the window |
| Snapshots | Snapshots received, and how many had changes |
| History chain | *Intact* when every snapshot links to the one before it, otherwise the number of breaks |

## Active time vs editor time

**Active time** comes from the snapshots. They are grouped into *sessions*: runs of snapshots whose tree changed, split wherever two captures are more than 15 minutes apart. A session's length is from its first change to its last.

**Editor time** comes from Hackatime heartbeats. It counts reading and navigating too, so it is usually higher than active time. Neither is wrong: together they tell you how much of your time turned into changes.

## Charts

- **Coding time per day**: active time per day, beside Hackatime's daily editor total. Hackatime's daily numbers are account-wide, not per project.
- **Total lines**: every snapshot in the window, plotted on the agent's clock.
- **Daily churn**: lines added above the axis, lines removed below. Counted line by line, so a rewritten line shows on both sides.
- **Saves by hour**: every save in the window by hour of day, in your timezone. Hover a bar for its count.
- **Where edits land**: changed lines in the last tenth of a file against everywhere before it. Writing new code mostly appends; refactoring and fixing mostly lands in the middle.
- **Weekly rhythm**: when the tree moves, by weekday and hour, in your timezone.

## Working tree now

The repository's uncommitted state at the latest snapshot: files staged, modified, untracked and in conflict, uncommitted lines, stashes, ahead and behind, and commits on HEAD. Only counts reach the server, never paths.

## Sessions

Each coding session in the window with its start, length, snapshot count, saves, lines added and removed, and files touched.

## Work per commit

Snapshots grouped by the commit that was HEAD when they were taken. *Committed* is when git says the commit was made; the span is how long you sat on it; the deltas and saves are the work you did on top of it. A red dot marks a commit whose tree was dirty at some point.

## Most-revised files

Files ranked by lines added and removed, with the revision count as a tie-break. *At end* is the share of those lines that landed in the last tenth of the file.

The names are salted path hashes, because the server never sees a path. Press **reveal** to copy a `snapshot-agent reveal` command, and run it on the machine that made the snapshot to see the file's name.

For windows that predate per-line diffs, the ranking falls back to the change in each file's line count between stored file lists, so a replaced line reads as zero there.

## Shared code

Files whose code fingerprints match another file in **your** projects: the same runs of 30 tokens after comments and whitespace are stripped, so a copy survives reformatting. Each row shows what share of the file's fingerprints match, and the other file and project. Common reasons are code copied between projects, a file duplicated and edited, or generated code.

Only the latest fingerprints of each file are kept, and nothing is ever compared with another person's account.

## Agent and integrity

- **Chain**: whether every snapshot links to the one before it. Each break is listed with its time and what it means: a *gap* (snapshots lost, usually the offline queue overflowing), a *fork* (history branched) or a *restart* (the agent's state file was reset).
- **Capture time** and **Slowest capture**: how long the walk and git took. A project that grows too big to snapshot cheaply shows here first.
- **Files skipped**: files over 2 MB or unreadable, left out of lines and the tree hash.
- **Fingerprinted**, **Agent**, **Platform** and **Repo size**.

## Hackatime projects

With the source set to Hackatime only, a table shows every Hackatime project in the window, its editor time and share, and the snapshot CLI's active time for a project with the same name. A mismatch usually means the names differ; see [Hackatime](#/docs/hackatime#matching-projects).
