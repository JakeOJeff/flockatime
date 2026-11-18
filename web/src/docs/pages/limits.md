# Known limits

What flockatime does not do, or does only approximately, and why.

## Older data has net line counts only

Agents before 0.3 sent a line count per file, not line diffs, so for those snapshots "lines moved" is the change in a file's line count and replacing a line reads as zero. From 0.3 the agent counts added and removed lines itself, from hashes it keeps locally. Mixed windows use true counts where they exist and the net estimate elsewhere, and the **Lines written** tile says *net estimate* when no true counts are in range.

A project's first 0.3 snapshot, and the first one after the path salt changes, is a baseline with no line counts.

## Save times need the predecessor

Saves are sent as offsets from the agent's previous capture. The server turns them into times using the snapshot stored before it; for a project's very first snapshot it keeps the count but not the times.

## Fingerprints are the latest only

Only each file's most recent fingerprints are kept, so **Shared code** compares files as they are now, not as they were. Overlap is computed over at most 20,000 fingerprinted files per account, newest first, and only within one account.

## A late flush does not fix what follows it

When a queued snapshot arrives older than rows already stored, it gets a correct diff against its true predecessor. The snapshot right after it keeps the summary it was stored with, which is now slightly stale. It is not recomputed.

## Days are cut in your current time zone

Daily roll-ups and the weekly rhythm use your *current* UTC offset. Days that crossed a daylight-saving change can be off by an hour at the edges.

## Hackatime's daily totals are account-wide

Hackatime does not split daily time by project, so on a project page the Hackatime series is your total editor time that day, not time on that project.

## Very large projects

- Files over 2 MB are not counted.
- File lists over 100,000 files, or over about 1.9 MB compressed, are not stored. Snapshots still land, but churn cannot use those trees.
- For windows without per-line diffs, churn compares at most 200 distinct trees per request.
- The agent drops fingerprints to keep a snapshot under 1 MB.

## Storage

File lists live in D1, which caps at 500 MB on Cloudflare's free plan. See [Deploy your own](#/docs/self-host#storage-limits).

## Local development has one account

With `REQUIRE_AUTH=false`, everything is filed under a single `local` account.
