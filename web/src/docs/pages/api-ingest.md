# Ingest API

The one endpoint the agent writes to. Anything that speaks this format can feed flockatime, and the agent can feed anything that accepts it.

## POST /v1/snapshots

```http
POST /v1/snapshots
Authorization: Bearer flk_...
Content-Type: application/json
```

The body is **always an array** of snapshots, oldest first. A bare object is tolerated.

```json
[
  {
    "project": "flockatime-cli",
    "captured_at": 1788371950,
    "tree_hash": "f397336f865d…",
    "file_count": 28,
    "total_lines": 3800,
    "total_bytes": 120578,
    "skipped_files": 0,
    "git": {
      "head": "eb4cf53b…", "branch": "main", "dirty": true, "ahead": 0, "behind": 0,
      "staged": 0, "modified": 4, "untracked": 1, "conflicted": 0,
      "insertions": 222, "deletions": 33, "commits": 27, "last_commit_at": 1788370000, "stashes": 0
    },
    "files": [
      { "path_hash": "618cd5b8…", "content_hash": "52d9604e…", "lines": 10, "bytes": 298, "mtime": 1787687549,
        "added": 6, "removed": 1, "tail": 6, "mid": 1, "fp": [301247718934, 902811256601] }
    ],
    "unchanged": false,
    "capture_ms": 41,
    "os": "windows",
    "arch": "amd64",
    "agent_version": "0.3.0",
    "seq": 42,
    "prev": "a91c03d7e2b4…",
    "saves": [14, 31, 33, 95],
    "build_at": 1788371800,
    "test_at": 1788371500
  }
]
```

## Snapshot fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `project` | string | Yes | At most 128 characters |
| `captured_at` | number | Yes | Unix seconds, agent clock |
| `tree_hash` | string | Yes | 64 lowercase hex characters |
| `file_count` | number | Yes | |
| `total_lines` | number | Yes | |
| `total_bytes`, `skipped_files`, `capture_ms` | number | No | Repo size, files over 2 MB or unreadable, capture time |
| `os`, `arch` | string | No | Platform |
| `git` | object | No | `head`, `branch`, `dirty`, `ahead`, and counts: `behind`, `staged`, `modified`, `untracked`, `conflicted`, `insertions`, `deletions`, `commits`, `last_commit_at`, `stashes` |
| `files` | array | No | Omitted or empty when unchanged |
| `unchanged` | boolean | No | Tree hash matches the previous snapshot |
| `agent_version` | string | No | |
| `seq`, `prev` | number, string | No | Chain position, and the previous snapshot's `tree_hash` |
| `saves` | number[] | No | Seconds after the previous capture at which a file was saved |
| `build_at`, `test_at` | number | No | Last touch of build output and test caches |

Each file record needs `path_hash` and `content_hash`; `lines`, `bytes` and `mtime` default to 0. `added`, `removed`, `tail` and `mid` are stored per snapshot in `file_edits`, and `fp` (at most 64 integers below 2⁵³) as the file's latest fingerprints. The stored file list keeps only the first five fields. Any other field is discarded, never stored.

The server checks `seq` / `prev` against the snapshot stored before each one and records `ok`, `start`, `gap`, `fork` or `restart`.

## Responses

| Status | Body | Meaning |
|---|---|---|
| `202` | `{"accepted": 3, "skipped": 0}` | Stored. `skipped` counts malformed records dropped |
| `400` | `{"error": "invalid json"}` | Body is not JSON |
| `401` | `{"error": "…"}` | Missing, unknown or revoked key, or account not allowed |
| `413` | `{"error": "batch too large"}` | More than 5,000 snapshots |
| `500` | `{"error": "internal error"}` | Transient. The agent re-queues and retries |

The agent treats **any 2xx** as accepted and ignores the body.

## Guarantees

- **Idempotent.** Snapshots are unique on `(project, captured_at, tree_hash)`. Re-sending a batch stores nothing new.
- **Malformed records are dropped, not rejected.** One bad record never blocks the rest of its batch.
- **Diffs are computed at ingest,** against the latest snapshot *captured before* this one, so a late queue flush still gets a correct diff.
- **Large lists are capped.** Lists over 100,000 files, or over about 1.9 MB compressed, are not stored; the snapshot's summary still is.

## GET /v1/snapshots

Unauthenticated. Returns `{"ok": true, "service": "flockatime"}`. `snapshot-agent doctor` uses it to check the endpoint answers.

## GET /healthz

Returns `{"ok": true}`.
