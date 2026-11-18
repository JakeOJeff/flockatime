# Commands

Every `snapshot-agent` command, and when to reach for it.

| Command | Does |
|---|---|
| `setup` | Checks the key, writes config, enables the WakaTime debug log, starts at login |
| `once [dir]` | One snapshot, printed as JSON. Sends nothing |
| `run` | The daemon: capture every interval, send, queue on failure, update itself |
| `doctor` | Checks config, endpoint, the running agent and each project's state. Sends nothing |
| `reveal HASH` | Shows which local file a path hash names. Sends nothing |
| `update [--check]` | Installs the newest release now |
| `install` | Starts the agent now and at every login |
| `uninstall` | Stops starting it at login |
| `devserver [port]` | A local collector that prints what it receives |
| `version` | Prints the version |

## setup

```sh
snapshot-agent setup --endpoint https://flockatime.curiousengine.org
```

Everything the install command does after downloading. The key is read from `FLOCKATIME_KEY`; `--key` also works but puts it on the command line, where other processes can see it.

| Flag | Default | Meaning |
|---|---|---|
| `--endpoint` | | Server URL. `/v1/snapshots` is appended |
| `--key` | `$FLOCKATIME_KEY` | Agent key from the dashboard |
| `--interval` | `120` | Seconds between captures while you are coding |
| `--no-start` | `false` | Write the config but do not install or start the agent |

In order, it:

1. checks the key with the server, before writing anything,
2. writes `~/.snapshot-agent.toml` with `[activity] source = "wakatime"` (an unreadable old config is backed up, not overwritten),
3. turns on `debug = true` in `~/.wakatime.cfg`,
4. installs the login item and starts the agent.

## once

```sh
snapshot-agent once .
```

Captures one snapshot and prints the JSON. Nothing is sent. With a directory it needs no config at all, which makes it the quickest way to see what the agent would send. It diffs against the saved line state without updating it, so looking never eats the daemon's line counts or skips a sequence number.

## run

The daemon. Normally the login item starts it for you. Run it in a terminal to watch it work:

```text
project "flockatime": 41 files, 6120 lines (+12 -3), 4 saves, 2 fingerprinted, seq 57, tree 9c1e0a4b7f2d
sent 1 snapshot(s)
```

Set `SNAPSHOT_AGENT_CONFIG` to use a config other than `~/.snapshot-agent.toml`:

```sh
SNAPSHOT_AGENT_CONFIG=./loop.toml snapshot-agent run
```

`run` also checks for a newer release when it starts and before captures, at most hourly, and restarts itself into it. See [update](#update).

## doctor

**Start here whenever something seems wrong.** It sends nothing, and reports:

- which config it read, and whether the endpoint answered,
- whether the WakaTime debug log is on,
- whether the agent is running, and whether its save poller is on and how many files it watches,
- how many changed files were fingerprinted,
- per project: the state file (sequence number, files remembered, whether it was written with the same path salt, or is missing or corrupt) and what the server will see as a result, plus how many files can be fingerprinted.

A missing or corrupt state file means the next snapshot restarts the chain at 1, which the dashboard shows as a **restart**.

## reveal

```sh
snapshot-agent reveal 9d2e4c18 --project flockatime
```

Maps a `path_hash` from the dashboard back to a file name, on your machine only. It hashes the names of the files a capture would see, with the same salt, and prints the matches. At least the first 8 hex characters are needed.

| Flag | Meaning |
|---|---|
| `--project NAME` | Only search the project with this name |
| `--dir PATH` | Search this directory instead of the configured projects |

Without either, it searches the projects WakaTime saw in the last 90 days. Every path hash on the dashboard has a **reveal** button that copies this command for you.

## update

```sh
snapshot-agent update          # install the newest release now
snapshot-agent update --check  # only report whether one exists
```

Downloads this platform's archive from the latest GitHub release, checks it against `SHA256SUMS`, runs the new binary's `version` to confirm it, and swaps it in place. Any failure keeps the old binary. A tag that is not plain `X.Y.Z` (such as `v0.3.0-rc1`) is never installed automatically.

Automatic updates are on by default. Turn them off with `auto_update = false` in the config or `SNAPSHOT_AGENT_NO_UPDATE=1`.

## install and uninstall

`install` registers the login item for the current config and starts the agent: a hidden Startup item on Windows, a LaunchAgent on macOS, a systemd user unit on Linux. It warns if the config is not usable yet, since the agent would otherwise exit silently at login.

`uninstall` removes it. Config, queue and state are never touched. To remove the agent and all its files, use the uninstall command on [Extensions](#/extensions/uninstall).

## devserver

```sh
snapshot-agent devserver 8799
```

A tiny collector that prints every batch it receives. Useful for seeing exactly what goes over the wire. It listens on `127.0.0.1:8787` by default, the same port as a local flockatime server.
