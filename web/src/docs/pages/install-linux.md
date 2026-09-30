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

```sh
snapshot-agent uninstall
```

This runs `systemctl --user disable --now snapshot-agent.service` and removes the unit file. Your config and queue are kept.
