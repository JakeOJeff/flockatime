# Dashboard API

The read API behind the dashboard. Every `/api/*` route needs a signed-in session cookie and answers only for that account. Responses are sent with `cache-control: private, no-store`.

## Common parameters

| Param | Default | Meaning |
|---|---|---|
| `days` | `7` | Window size, clamped to 1–365 |
| `tz` | `0` | Your UTC offset in minutes, as `-new Date().getTimezoneOffset()`. Used to cut days and hours |

A project name in a path must be URL-encoded. An unknown project returns `404 {"error": "unknown project"}`.

## GET /auth/me

Who is signed in. Used by the dashboard to decide whether to show the sign-in screen.

## GET /api/projects

Every project with the state of its most recent snapshot: `name`, `captured_at`, `received_at`, `file_count`, `total_lines`, `tree_hash`, the git fields and `agent_version`.

## GET /api/projects/:name/timeline

Every snapshot in the window, oldest first, with summary columns only: counts, diff summary, git state. No file lists.

## GET /api/projects/:name/summary

Headline totals for the window (active snapshots, lines added and removed, files touched, commits, branches, delayed snapshots and the largest lag) and a per-day roll-up in your time zone. Takes `tz`.

## GET /api/projects/:name/sessions

Coding sessions: runs of changed snapshots split on `SESSION_GAP_SECONDS`, newest first. Defaults to a 30-day window.

```json
{
  "sessions": [
    { "started_at": 1788360000, "ended_at": 1788367200, "seconds": 7200, "ticks": 58,
      "lines_added": 412, "lines_removed": 96, "files_touched": 31 }
  ],
  "gap_seconds": 900
}
```

## GET /api/projects/:name/rhythm

Active snapshots and lines moved per weekday (`dow`, 0 = Sunday) and `hour`, in your time zone. Takes `tz`.

## GET /api/projects/:name/commits

Work grouped by HEAD commit: span, snapshot counts, lines added and removed, files touched and whether it was ever dirty. The 50 most recent.

## GET /api/projects/:name/churn

The 25 most-revised files by net lines moved, as path hashes, with `revisions` and current `lines`. The only endpoint that reads stored file lists, so it compares at most 200 distinct trees.

## GET /api/hackatime

Your Hackatime stats for the window: totals, streak, languages, projects, editors, operating systems, categories, per-day seconds and a 24-hour profile. Takes `days` and `tz`. Returns `{"configured": false}` if there is no way to look you up, or an `error` of `not_found`, `private`, `bad_key` or `unavailable`.

## Keys

| Route | Does |
|---|---|
| `GET /api/keys` | Your keys, active first |
| `POST /api/keys` | Mint a key. Body `{"label": "…"}`. Returns `201 {"token": "flk_…"}`, the only time the token is shown |
| `DELETE /api/keys/:id` | Revoke a key. Body `{}` |

Writes must be sent as `application/json` or they get `415`. A cross-site form cannot send JSON without a CORS preflight, which the Worker never answers. More than 50 active keys returns `409`.
