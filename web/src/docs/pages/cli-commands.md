# Commands

Every `snapshot-agent` command, and when to reach for it.

| Command | Does |
|---|---|
| `setup` | Checks the key, writes config, enables the WakaTime debug log, starts at login |
| `once [dir]` | One snapshot, printed as JSON. Sends nothing |
| `run` | The daemon: capture every interval, send, queue on failure |
| `doctor` | Validates config, probes the endpoint, lists projects. Sends nothing |
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

Captures one snapshot and prints the JSON. Nothing is sent. With a directory it needs no config at all, which makes it the quickest way to see what the agent would send, and to map a path hash on the dashboard back to a file.

## run

The daemon. Normally the login item starts it for you. Run it in a terminal to watch it work:

```text
project "flockatime": 41 files, 6120 lines, tree 9c1e0a4b7f2d
sent 1 snapshot(s)
```

Set `SNAPSHOT_AGENT_CONFIG` to use a config other than `~/.snapshot-agent.toml`:

```sh
SNAPSHOT_AGENT_CONFIG=./loop.toml snapshot-agent run
```

## doctor

**Start here whenever something seems wrong.** It reports which config it read, whether the endpoint answered, whether the WakaTime debug log is on, and which projects it would capture with their file counts. It sends nothing.

## install and uninstall

`install` registers the login item for the current config and starts the agent: a hidden Startup item on Windows, a LaunchAgent on macOS, a systemd user unit on Linux. It warns if the config is not usable yet, since the agent would otherwise exit silently at login.

`uninstall` removes it. Config and queue are never touched.

## devserver

```sh
snapshot-agent devserver 8799
```

A tiny collector that prints every batch it receives. Useful for seeing exactly what goes over the wire. It listens on `127.0.0.1:8787` by default, the same port as a local flockatime server.
