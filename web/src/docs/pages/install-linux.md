# Linux

Install snapshot-agent with one terminal command. No `sudo` needed.

## Requirements

- Linux on `amd64` or `arm64`
- systemd for start-at-login (see [Without systemd](#without-systemd) otherwise)
- Hackatime set up in your editor on this machine
- A flockatime account

## Install

1. Open **[Extensions](#/extensions)**, choose **macOS / Linux** and press **Generate install command**.
2. Paste it into a terminal:

```sh
curl -fsSL https://flockatime.curiousengine.org/install.sh | FLOCKATIME_KEY=flk_... sh
```

The script downloads `snapshot-agent_linux_<arch>.tar.gz`, verifies it with `sha256sum` (or `shasum`) against `SHA256SUMS`, installs it to `~/.flockatime/bin` and runs `snapshot-agent setup`.

## Where things live

| What | Where |
|---|---|
| Binary | `~/.flockatime/bin/snapshot-agent` |
| Config | `~/.snapshot-agent.toml` (mode `600`) |
| Login item | `~/.config/systemd/user/snapshot-agent.service` |
| Log | the user journal |

## Add it to your PATH

```sh
echo 'export PATH="$HOME/.flockatime/bin:$PATH"' >> ~/.bashrc
```

## Check it

```sh
snapshot-agent doctor
systemctl --user status snapshot-agent
journalctl --user -u snapshot-agent -f
```

## Without systemd

`setup` and `install` need systemd to start the agent at login. On other init systems, write the config with `setup --no-start` and start `snapshot-agent run` however you start your other background programs:

```sh
FLOCKATIME_KEY=flk_... snapshot-agent setup --endpoint https://flockatime.curiousengine.org --no-start
snapshot-agent run
```

## Uninstall

To remove snapshot-agent completely, run this. It needs no key, and [Extensions](#/extensions/uninstall) shows the same command with a Copy button:

```sh
curl -fsSL https://flockatime.curiousengine.org/uninstall.sh | sh
```

It disables and stops the systemd user service (and any agent started by hand), then deletes the unit file, `~/.flockatime`, `~/.snapshot-agent.toml` and `~/.snapshot-agent-queue.db`. Remove the `PATH` line from `~/.bashrc` if you added one. Snapshots still waiting in the queue are lost. Hackatime, `~/.wakatime.cfg` and everything already on the dashboard are left alone. Then revoke the machine's key in [Settings](#/settings).

### Only stop it starting at login

```sh
snapshot-agent uninstall
```

This runs `systemctl --user disable --now snapshot-agent.service` and removes the unit file. Your config and queue are kept.
