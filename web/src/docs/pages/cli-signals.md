# What the agent records

Every field a snapshot carries since snapshot-agent 0.3, what it is for, and where it shows up on the dashboard. None of it is file contents or file names.

## What changed in 0.3

snapshot-agent 0.2.2 and 0.3.0 send far more than the tree's line count. In short:

| Added in | What | Shows up as |
|---|---|---|
| 0.2.2 | Working-tree counts: staged, modified, untracked, conflicted, uncommitted lines, stashes, commits behind | **Working tree now** card, project-card flags |
| 0.2.2 | Commit count and the last commit's time | **Commits made** tile, *Committed* column |
| 0.2.2 | Repo size, skipped files, capture time, OS and CPU | **Lines** tile, **Agent and integrity**, Settings → Agents |
| 0.3.0 | True per-file line diffs: added, removed, and where in the file | **Lines written**, **Daily churn**, **Where edits land**, **Most-revised files** |
| 0.3.0 | A `seq` / `prev` hash chain | **History chain** tile, chain breaks list |
| 0.3.0 | Save times between captures | **Saves** tile, **Saves by hour**, saves per session and commit |
| 0.3.0 | When build output and test caches were last touched | **Builds · tests** tile |
| 0.3.0 | Winnowed code fingerprints | **Shared code** |
| 0.3.0 | Salted path hashes, and `reveal` | The *reveal* button beside every path hash |
| 0.3.0 | Self-updating from GitHub releases, a richer `doctor` | Agents update themselves; Settings flags any left behind |

Older agents keep working. Anything they do not send reads as **—** or "needs agent 0.3", and line counts fall back to the net change in total lines.

## A snapshot, field by field

```json
{
  "project": "flockatime-cli",
  "captured_at": 1788371950,
  "tree_hash": "f397336f865d...",
  "file_count": 28,
  "total_lines": 3800,
  "total_bytes": 120578,
  "skipped_files": 0,
  "git": {
    "head": "eb4cf53b...", "branch": "main", "dirty": true, "ahead": 0, "behind": 0,
    "staged": 0, "modified": 4, "untracked": 1, "conflicted": 0,
    "insertions": 222, "deletions": 33,
    "commits": 27, "last_commit_at": 1788370000, "stashes": 0
  },
  "files": [
    { "path_hash": "618cd5b8...", "content_hash": "52d9604e...", "lines": 10, "bytes": 298, "mtime": 1787687549,
      "added": 6, "removed": 1, "tail": 6, "mid": 1, "fp": [301247718934, 902811256601] }
  ],
  "capture_ms": 41,
  "os": "windows",
  "arch": "amd64",
  "agent_version": "0.3.0",
  "seq": 42,
  "prev": "a91c03d7e2b4...",
  "saves": [14, 31, 33, 95],
  "build_at": 1788371800,
  "test_at": 1788371500
}
```

## Working tree

Past `branch`, the git block is only counts, read from `git status` and `git diff --shortstat` with every path discarded: files staged, modified, untracked and in conflict, lines inserted and deleted against `HEAD`, commits on `HEAD`, the last commit's time, and stashes.

On the dashboard, **Working tree now** shows them for the latest snapshot. Project cards flag a merge conflict, uncommitted lines and commits behind upstream. **Commits made** is how much git's commit count grew in the window.

## Line diffs

Each changed file carries `added` and `removed`: lines added and removed since the last snapshot, from a Myers diff of per-line hashes the agent keeps on your machine. They are split by where they fall:

- `tail`: changed lines in the last ~10% of the file,
- `mid`: everywhere before it.

So `tail + mid = added + removed`. Before 0.3 the server only had the change in each file's line count, so a rewritten line read as zero. Now **Lines written**, **Daily churn**, **Sessions** and **Most-revised files** count every line. **Where edits land** splits them into appending and editing in the middle.

A project's first snapshot is the baseline and has no counts.

## The hash chain

Each project's snapshots are numbered 1, 2, 3…, and `prev` is the `tree_hash` of the one before. The server checks each snapshot against the one stored before it:

| Status | Meaning |
|---|---|
| ok | `seq` is one more and `prev` matches |
| start | The first chained snapshot this server has for the project |
| gap | `seq` skipped ahead: snapshots were lost. Usually the offline queue dropped its oldest past 5,000 |
| fork | `prev` does not match, or `seq` went backwards: history branched |
| restart | `seq` is back at 1: the agent's state file was deleted or reset |

**History chain** reads *Intact* when every snapshot links up, and **Agent and integrity** lists each break with its time. Forging a session means faking a whole consistent history, not one request.

## Saves

`saves` lists the seconds after the previous capture at which a known file's modified time moved. Between captures, `run` stats the files of the last capture every 10 seconds, only while you are active, and never opens them. Several saves of one file inside a 10-second poll count once.

The server turns the offsets into times, so **Saves by hour** can show your saving rhythm in your timezone, and **Sessions** and **Work per commit** count saves alongside lines.

## Builds and tests

`build_at` and `test_at` are the newest modified times at the top of skipped build output (`dist/`, `target/`, an ignored `build/`, …) and test caches (`.pytest_cache/`, an ignored `coverage/`, `.coverage`). Only `stat` is used; their contents are never walked. **Builds · tests** counts the distinct times seen in the window, which is roughly how many times you built and ran tests.

## Fingerprints

For files whose content changed (or every file, on a project's first capture), the agent sends up to 50 winnowed fingerprints, the MOSS technique. Comments and whitespace are stripped, every run of 30 tokens is hashed, and the smallest hash of each window of 8 is kept. A copied block still shares fingerprints with its source after being reindented or re-commented.

The server keeps the latest set per file and compares them across **your own** projects only. **Shared code** lists files that share at least two fingerprints with another file, and what share of the file that is.

If fingerprints would push a snapshot past 1 MB, the agent drops them, least-changed files first. The file list itself is never cut.

## Capture cost and platform

`capture_ms` is how long the walk and git took, `skipped_files` counts files left out for being over 2 MB or unreadable, and `os` / `arch` name the platform. **Agent and integrity** shows the average and slowest capture, and Settings lists every platform and agent version reporting to your account.
