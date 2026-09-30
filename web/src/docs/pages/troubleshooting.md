# Troubleshooting

Most problems are one of a handful. Start every investigation with:

```sh
snapshot-agent doctor
```

It reports which config it read, whether the server answered, whether the WakaTime debug log is on, and what it would capture. It sends nothing.

## No projects show up

Work through these in order:

1. **Is Hackatime working?** Check that your time appears on hackatime.hackclub.com. The agent follows it, so no Hackatime means no projects.
2. **Is the WakaTime debug log on?** `doctor` tells you. If not, add `debug = true` under `[settings]` in `~/.wakatime.cfg`, or run the install command again.
3. **Is it a git repository?** The agent snapshots the repository the file you are editing belongs to.
4. **Is the agent running?** See [The agent is not running](#the-agent-is-not-running).
5. **Did you wait?** With the standard two-minute interval, a project can take a couple of minutes to appear.

Use the **Snapshot CLI only** [data source](#/docs/data-sources) and the status card in [Settings](#/settings) to see what the server has received.

## The install command failed

| Message | Fix |
|---|---|
| `FLOCKATIME_KEY is not set` | Copy the whole command from Extensions, not just the URL |
| `checksum mismatch` | The download was corrupted or tampered with. Run it again; if it persists, open an issue |
| `checking key … failed` | The key is wrong or revoked. Generate a new command |
| `unsupported OS` or `unsupported CPU` | No prebuilt binary for this platform. Build from source |
| `wakatime: not installed` | Set up Hackatime, then run the command again |

On Windows, run the command in **PowerShell**, not Command Prompt.

## The agent is not running

- **Windows:** look for `snapshot-agent.exe` in Task Manager. The login item is `snapshot-agent.vbs` in your Startup folder.
- **macOS:** `launchctl list | grep snapshot-agent`, and read `~/Library/Logs/snapshot-agent.log`.
- **Linux:** `systemctl --user status snapshot-agent` and `journalctl --user -u snapshot-agent`.

If it exits straight away, run `snapshot-agent run` in a terminal to see why. The usual causes are below.

## "config has mode 0644; must be 0600"

On macOS and Linux the config holds your key, so it must be private:

```sh
chmod 600 ~/.snapshot-agent.toml
```

## "endpoint is plain http"

The agent will not send a key over plain `http://` except to localhost. Use the `https://` address of your server.

## 401 errors in the agent log

The server rejected the key. It was revoked, the account was removed from the allowlist, or the config has the wrong key. Generate a new install command and run it. Snapshots taken in the meantime are queued and sent once the key works.

## Charts show work at the wrong time

Charts use your machine's clock at capture time. If snapshots were queued while offline, they appear when they were **captured**, which is correct. If the clock itself is wrong, fix the system clock. See [Offline queue](#/docs/offline-queue#clock-skew).

## Hackatime panels are empty or show an error

See [Hackatime](#/docs/hackatime#if-it-is-not-connecting). The most common cause is private stats.

## A project's Hackatime tile says "no Hackatime project by this name"

The agent's project name and Hackatime's differ. Add a `.wakatime-project` file with the name you want to the repository root. See [Matching projects](#/docs/hackatime#matching-projects).

## Sign-in says "not allowed"

Your email is not on this server's allowlist. Ask whoever runs it to add you, or [deploy your own](#/docs/self-host).

## Still stuck?

[Open an issue](https://github.com/JakeOJeff/flockatime/issues) with the output of `snapshot-agent doctor` and `snapshot-agent version`. Remove any `flk_` key from what you paste.
