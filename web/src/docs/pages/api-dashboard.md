# Dashboard API

The read API behind the dashboard. Every `/api/*` route needs a signed-in session cookie and answers only for that account. Responses are sent with `cache-control: private, no-store`.

## Common parameters

| Param | Default | Meaning |
|---|---|---|
| `days` | `7` | Window size, clamped to 1–3650 (the dashboard sends 3650 for All time) |
| `tz` | `0` | Your UTC offset in minutes, as `-new Date().getTimezoneOffset()`. Used to cut days and hours |

A project name in a path must be URL-encoded. An unknown project returns `404 {"error": "unknown project"}`.

## GET /auth/me

Who is signed in. Used by the dashboard to decide whether to show the sign-in screen.

## GET /api/projects

Every project with the state of its most recent snapshot: `name`, `captured_at`, `received_at`, line, file and byte counts, `skipped_files`, `capture_ms`, `os`, `arch`, `agent_version`, every git field, `seq`, `chain`, `build_at` and `test_at`. Also `active_seconds` (its sessions summed over the window, the same number as the project page's Active time) and `window`: `snapshots`, `lines_added`, `lines_removed`, `saves`, `builds`, `tests` and `chain_breaks` in the window. Takes `days` (default 7).

## GET /api/projects/:name/timeline

Every snapshot in the window, oldest first, with summary columns only: counts, diff summary, true line counts, saves, git state and chain. No file lists.

## GET /api/projects/:name/summary

Headline totals for the window (active snapshots, lines added and removed, tail and mid edits, files touched, commits, saves, builds, tests, capture cost, chain gaps, forks and restarts, delayed snapshots and the largest lag), a per-day roll-up in your time zone, and `breaks`: the 20 most recent chain breaks. Takes `tz`.

Lines fall back to the net change in total lines for snapshots without true line counts; `exact_added` is null when every count in the window is such an estimate.

## GET /api/projects/:name/sessions

Coding sessions: runs of changed snapshots split on `SESSION_GAP_SECONDS`, newest first. Defaults to a 30-day window.

```json
{
  "sessions": [
    { "started_at": 1788360000, "ended_at": 1788367200, "seconds": 7200, "ticks": 58,
      "lines_added": 412, "lines_removed": 96, "files_touched": 31, "saves": 140 }
  ],
  "gap_seconds": 900
}
```

## GET /api/projects/:name/rhythm

Active snapshots and lines moved per weekday (`dow`, 0 = Sunday) and `hour`, in your time zone. Takes `tz`.

## GET /api/projects/:name/commits

Work grouped by HEAD commit: span, snapshot counts, lines added and removed, saves, files touched, `committed_at` and whether it was ever dirty. The 50 most recent.

## GET /api/projects/:name/churn

The 25 most-revised files as path hashes, with `revisions` and current `lines`. With `source: "edits"` they are ranked by true lines added and removed, with `added`, `removed`, `tail`, `mid` and `last_edit`. For windows with no per-line diffs, `source: "trees"` ranks by net lines moved between stored file lists, comparing at most 200 distinct trees.

## GET /api/projects/:name/saves

Saves per local hour of day (`hours`, 24 counts) and the `total` in the window. Takes `tz`.

## GET /api/projects/:name/overlap

Files in the project sharing at least two fingerprints with another file of the same account: `path_hash`, `prints`, `shared`, and the other file's `other_project` and `other_path_hash`. The 50 with the largest share, plus `files_fingerprinted` and `files_compared`.

## GET /api/agents

One row per OS, CPU and agent version that sent snapshots in the window (default 30 days), with `projects`, `snapshots`, `last_seen` and `avg_capture_ms`.

## GET /api/hackatime

Your Hackatime stats for the window: totals, streak, languages, projects, editors, operating systems, categories, per-day seconds and a 24-hour profile. Takes `days` and `tz`. Returns `{"configured": false}` if there is no way to look you up, or an `error` of `not_found`, `private`, `bad_key` or `unavailable`.

## Keys

| Route | Does |
|---|---|
| `GET /api/keys` | Your keys, active first |
| `POST /api/keys` | Mint a key. Body `{"label": "…"}`. Returns `201 {"token": "flk_…"}`, the only time the token is shown |
| `DELETE /api/keys/:id` | Revoke a key. Body `{}` |

Writes must be sent as `application/json` or they get `415`. A cross-site form cannot send JSON without a CORS preflight, which the Worker never answers. More than 50 active keys returns `409`.
