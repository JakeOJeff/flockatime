# macOS

Install snapshot-agent with one terminal command. No `sudo` needed.

## Requirements

- macOS on Apple silicon (`arm64`) or Intel (`amd64`)
- Hackatime set up in your editor on this machine
- A flockatime account

## Install

1. Open **[Extensions](#/extensions)**, choose **macOS / Linux** and press **Generate install command**.
2. Paste it into Terminal:

```sh
curl -fsSL https://flockatime.curiousengine.org/install.sh | FLOCKATIME_KEY=flk_... sh
```

The script downloads `snapshot-agent_darwin_<arch>.tar.gz`, verifies it against `SHA256SUMS`, installs it to `~/.flockatime/bin` and runs `snapshot-agent setup`.

## Where things live

| What | Where |
|---|---|
| Binary | `~/.flockatime/bin/snapshot-agent` |
| Config | `~/.snapshot-agent.toml` (mode `600`) |
| Login item | `~/Library/LaunchAgents/com.snapshot-agent.plist` |
| Log | `~/Library/Logs/snapshot-agent.log` |

## Add it to your PATH

The installer tells you if `~/.flockatime/bin` is not on your `PATH`. Add it to `~/.zshrc`:

```sh
export PATH="$HOME/.flockatime/bin:$PATH"
```

## Check it

```sh
snapshot-agent doctor
tail -f ~/Library/Logs/snapshot-agent.log
```

## Upgrade

Run the install command again. The new binary is swapped in by rename, so a running agent keeps working until setup restarts it.

## Uninstall

```sh
snapshot-agent uninstall
```

This unloads the LaunchAgent, stops the agent and removes the plist. Your config and queue are kept.
