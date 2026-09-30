# Windows

Install snapshot-agent with one PowerShell command. No Administrator rights needed.

## Requirements

- Windows 10 or 11, x64 or ARM64
- Hackatime set up in your editor on this machine
- A flockatime account

## Install

1. Open **[Extensions](#/extensions)**, choose **Windows (PowerShell)** and press **Generate install command**.
2. Open PowerShell (not Command Prompt) and paste it:

```powershell
$env:FLOCKATIME_KEY='flk_...'; irm https://flockatime.curiousengine.org/install.ps1 | iex
```

The script:

- picks `snapshot-agent_windows_amd64.zip` or `_arm64.zip` for your CPU,
- verifies it against the release's `SHA256SUMS` and stops on a mismatch,
- stops a running agent so its binary can be replaced,
- copies it to `%USERPROFILE%\.flockatime\bin` and adds that folder to your user `PATH`,
- runs `snapshot-agent setup`, then clears `FLOCKATIME_KEY` from the session.

## Where things live

| What | Where |
|---|---|
| Binary | `%USERPROFILE%\.flockatime\bin\snapshot-agent.exe` |
| Config | `%USERPROFILE%\.snapshot-agent.toml` |
| Login item | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\snapshot-agent.vbs` |
| WakaTime config | `%USERPROFILE%\.wakatime.cfg` |

The login item is a one-line script that starts the agent hidden, so no console window stays open. A Startup folder entry is used instead of a scheduled task because `schtasks /sc onlogon` needs Administrator.

## Check it

Open a **new** PowerShell window, so the updated `PATH` is picked up, and run:

```powershell
snapshot-agent doctor
```

## Upgrade

Run the install command again. It downloads the latest release, replaces the binary and restarts the agent. To switch keys, generate a new command and run that.

## Uninstall

```powershell
snapshot-agent uninstall
```

This removes the login item. An agent that is already running keeps going until you log out or end it in Task Manager. Your config and queue are left in place, so reinstalling picks up where you left off. Revoke the key in [Settings](#/settings) if you are done with this machine.

> **Tip:** when editing the config by hand, write Windows paths with forward slashes or in 'single quotes'. TOML reads `\U` in a double-quoted string as an escape code.
