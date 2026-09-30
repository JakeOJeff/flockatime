# How it works

flockatime joins two independent pipelines into one dashboard.

## Hackatime: editor time

Hackatime's editor plugins send *heartbeats* while you type: which file, which language, which editor. Hackatime turns them into time. flockatime never talks to your plugins. The server reads your stats from `hackatime.hackclub.com` and lays them next to its own data.

That powers the **Home** page: total time, top project, languages, editors, operating systems and the daily time chart.

## snapshot-agent: the shape of the project

`snapshot-agent` is a small Go program that runs in the background. While you are coding it wakes every interval (two minutes after a standard install) and walks the repository you are editing:

1. It lists every file, respecting `.gitignore` and always skipping `.git/`, `node_modules/`, `target/`, `dist/`, `vendor/` and any file over 2 MB.
2. For each file it records a SHA-256 of the **path**, a SHA-256 of the **contents**, the line count, the size and the modification time. The bytes go straight into the hasher and are discarded.
3. It computes a **tree hash**: SHA-256 over the sorted `path_hash:content_hash` list. One changed character anywhere changes it.
4. It reads git state: HEAD commit, branch, whether the tree is dirty, and how far it is ahead of upstream.

If the tree hash moved, the snapshot carries the full file list. If it did not, the agent sends a small `unchanged` marker instead, which keeps the timeline dense without resending the list.

## Following you, not a list

After a standard install the agent runs with `[activity] source = "wakatime"`. It reads the WakaTime debug log to learn which file you are in and snapshots **that** repository. It:

- wakes on your first heartbeat,
- names the project the way Hackatime does (a `.wakatime-project` file wins over the folder name),
- goes dormant after two quiet capture intervals, so an untouched tree is not snapshotted all night.

## On the server

The server is a single Cloudflare Worker with a D1 database.

- **Ingest is idempotent.** A snapshot is unique on `(project, captured_at, tree_hash)`, so a retried batch is harmless.
- **File lists are stored once.** A list is gzipped into a row keyed by its tree hash, and every later snapshot with the same hash points at it.
- **Diffs happen at ingest.** Files added, removed and modified, and the line delta, are computed while both lists are in memory and written onto the snapshot row. Normal page loads never unpack a file list.

## Offline

If the server cannot be reached, snapshots queue to disk with their original capture time and flush oldest-first once it is back. The dashboard plots them when they were **captured**, not when they arrived, and tells you when a window contains replayed snapshots.

## Accounts

Every signed-in person has their own account: their own keys, projects, snapshots and file lists. Nothing is shared between accounts, even when two people have a project with the same name.
