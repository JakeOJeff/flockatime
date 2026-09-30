# Known limits

What flockatime does not do, or does only approximately, and why.

## Lines moved is net, not diff

The agent sends a line count per file, not line-level hashes. "Lines moved" is the change in a file's line count, so replacing a line with another reads as zero. This is the price of never sending contents.

## A late flush does not fix what follows it

When a queued snapshot arrives older than rows already stored, it gets a correct diff against its true predecessor. The snapshot right after it keeps the summary it was stored with, which is now slightly stale. It is not recomputed.

## Days are cut in your current time zone

Daily roll-ups and the weekly rhythm use your *current* UTC offset. Days that crossed a daylight-saving change can be off by an hour at the edges.

## Hackatime's daily totals are account-wide

Hackatime does not split daily time by project, so on a project page the Hackatime series is your total editor time that day, not time on that project.

## Very large projects

- Files over 2 MB are not counted.
- File lists over 100,000 files, or over about 1.9 MB compressed, are not stored. Snapshots still land, but churn cannot use those trees.
- Churn compares at most 200 distinct trees per request.

## Storage

File lists live in D1, which caps at 500 MB on Cloudflare's free plan. See [Deploy your own](#/docs/self-host#storage-limits).

## Local development has one account

With `REQUIRE_AUTH=false`, everything is filed under a single `local` account.
