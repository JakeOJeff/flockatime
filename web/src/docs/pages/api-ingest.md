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
    "git": { "head": "eb4cf53b…", "branch": "main", "dirty": false, "ahead": 0 },
    "files": [
      { "path_hash": "618cd5b8…", "content_hash": "52d9604e…", "lines": 10, "bytes": 298, "mtime": 1787687549 }
    ],
    "unchanged": false,
    "agent_version": "0.2.0"
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
| `git` | object | No | `head`, `branch`, `dirty`, `ahead` |
| `files` | array | No | Omitted or empty when unchanged |
| `unchanged` | boolean | No | Tree hash matches the previous snapshot |
| `agent_version` | string | No | |

Each file record needs `path_hash` and `content_hash`; `lines`, `bytes` and `mtime` default to 0. Any other field is discarded, never stored.

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
