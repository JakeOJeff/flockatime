# Configuration

`setup` writes a working config, so most people never edit it. This page covers what is in it and what you can change.

## Location

The agent reads `~/.snapshot-agent.toml`, or the file named by `SNAPSHOT_AGENT_CONFIG`. On macOS and Linux it must be mode `600`, because it holds your key; the agent refuses to start if anyone else can read it.

## A standard config

```toml
endpoint = "https://flockatime.curiousengine.org"
api_key  = "flk_..."
interval_seconds = 120

[activity]
source = "wakatime"
```

## Reference

| Key | Default | Meaning |
|---|---|---|
| `endpoint` | required | Server URL. `/v1/snapshots` is appended. Must be `https://` unless it is localhost |
| `api_key` | required | Sent as `Authorization: Bearer <key>` |
| `interval_seconds` | `300` (`120` after `setup`) | Seconds between captures |
| `queue_path` | `~/.snapshot-agent-queue.db` | Where unsent snapshots wait |
| `activity.source` | none | `"wakatime"` to follow your editor |
| `activity.idle_multiplier` | `2` | Quiet intervals before going dormant |
| `[[project]]` | | Fixed projects to capture, each with `name` and `path` |

## Following Hackatime

With `source = "wakatime"` you do not list projects. The agent reads WakaTime's debug log to see which file you are editing and snapshots the git repository it belongs to. It wakes on your first heartbeat and goes dormant after `idle_multiplier × interval_seconds` without one: four minutes with the defaults above.

It needs this in `~/.wakatime.cfg`, which `setup` adds for you:

```ini
[settings]
debug = true
```

This only turns on local logging. Nothing about your heartbeats or Hackatime data changes.

## Fixed projects

Without an activity source, list projects explicitly. They are captured every interval, forever:

```toml
[[project]]
name = "website"
path = "~/src/website"

[[project]]
name = "game"
path = "C:/Users/you/code/game"
```

With `source = "wakatime"`, `[[project]]` entries are optional and are captured alongside whatever you are editing.

## Naming projects

A project is named the way Hackatime names it: the contents of a `.wakatime-project` file in the repository root if there is one, otherwise the folder name. Keep the names identical so the dashboard can match a project to its [Hackatime time](#/docs/hackatime).

## Capture rules

These are fixed:

- `.gitignore` is respected.
- `.git/`, `node_modules/`, `target/`, `dist/` and `vendor/` are always skipped.
- Files over 2 MB are skipped.

After editing the config, run `snapshot-agent doctor` to check it. The agent reads its config when it starts, so log out and back in (or run the install command again) for the change to take effect.
