# How it works

flockatime joins two independent pipelines into one dashboard.

## Hackatime: editor time

Hackatime's editor plugins send *heartbeats* while you type: which file, which language, which editor. Hackatime turns them into time. flockatime never talks to your plugins. The server reads your stats from `hackatime.hackclub.com` and lays them next to its own data.

That powers the **Home** page: total time, top project, languages, editors, operating systems and the daily time chart.

## snapshot-agent: the shape of the project

`snapshot-agent` is a small Go program that runs in the background. While you are coding it wakes every interval (two minutes after a standard install) and walks the repository you are editing:

1. It lists every file, respecting `.gitignore` and always skipping `.git`, `node_modules/`, `target/`, `dist/`, `vendor/` and any file over 2 MB.
2. For each file it records a **salted hash of the path**, a SHA-256 of the **contents**, the line count, the size and the modification time.
3. For each file that changed since the last capture, it diffs per-line hashes it keeps locally to count **lines added and removed**, and where they fell, and takes up to 50 **code fingerprints**.
4. It computes a **tree hash**: SHA-256 over the sorted `path_hash:content_hash` list. One changed character anywhere changes it.
5. It reads git state as counts: HEAD, branch, staged / modified / untracked / conflicted files, uncommitted lines, stashes, ahead / behind, commits and the last commit's time.
6. It notes when build output and test caches were last touched, without walking them.
7. It numbers the snapshot and links it to the previous one (`seq` / `prev`).

Between captures it stats the files it saw every 10 seconds to record **save times**, and never opens them.

If the tree hash moved, the snapshot carries the full file list. If it did not, the agent sends a small `unchanged` marker with the counts and saves, which keeps the timeline dense without resending the list.

See [What the agent records](#/docs/cli-signals) for every field.

## Following you, not a list

After a standard install the agent runs with `[activity] source = "wakatime"`. It reads the WakaTime debug log to learn which file you are in and snapshots **that** repository. It:

- wakes on your first heartbeat,
- names the project the way Hackatime does (a `.wakatime-project` file wins over the folder name),
- goes dormant after two quiet capture intervals, so an untouched tree is not snapshotted all night.

## Keeping itself up to date

`run` checks the GitHub releases at start and at most hourly. If there is a newer `X.Y.Z`, it downloads this platform's archive, checks it against `SHA256SUMS`, runs the new binary's `version` to confirm it, swaps it in and restarts. Any failure keeps the old binary.

## On the server

The server is a single Cloudflare Worker with a D1 database.

- **Ingest is idempotent.** A snapshot is unique on `(project, captured_at, tree_hash)`, so a retried batch is harmless.
- **File lists are stored once.** A list is gzipped into a row keyed by its tree hash, and every later snapshot with the same hash points at it.
- **Summaries happen at ingest.** Files added, removed and modified, true line counts, saves and the chain check are written onto the snapshot row while the batch is in memory. Per-file line edits go into their own table, and the latest fingerprints per file into another. Normal page loads never unpack a file list.

## Offline

If the server cannot be reached, snapshots queue to disk with their original capture time and flush oldest-first once it is back. The dashboard plots them when they were **captured**, not when they arrived, and tells you when a window contains replayed snapshots.

## Accounts

Every signed-in person has their own account: their own keys, projects, snapshots, file lists and fingerprints. Nothing is shared or compared between accounts, even when two people have a project with the same name.
