# Quick start

From nothing to a project on your dashboard in about five minutes.

## Before you start

You need **Hackatime** working in your editor on the machine you code on. The agent reads WakaTime's local log to learn which repository you are editing, so it cannot follow you without it.

If you have not set it up yet, go to [hackatime.hackclub.com](https://hackatime.hackclub.com), sign in and follow its setup for your editor. Check that your time shows up there before continuing.

## 1. Sign in

Open the dashboard and press **Sign in with Hack Club**. flockatime uses [Hack Club Auth](https://auth.hackclub.com), so there is no separate password.

> **Note:** a server only lets in the email addresses its owner allows. If you see "not allowed", ask whoever runs the server to add you.

## 2. Generate an install command

Open **[Extensions](#/extensions)** and press **Generate install command**. Pick your platform:

- **Windows (PowerShell)**
- **macOS / Linux**

The command contains a brand-new agent key and is shown **once**, so copy it before leaving the page. If you lose it, generate another and revoke the old key in [Settings](#/settings).

## 3. Run it

Paste the command into PowerShell or a terminal on the machine you code on. It:

1. Downloads the latest `snapshot-agent` release and checks it against `SHA256SUMS`.
2. Checks your key with the server before writing anything.
3. Writes `~/.snapshot-agent.toml`.
4. Turns on `debug = true` in `~/.wakatime.cfg` so the agent can see which file you are in.
5. Starts the agent now and at every login.

It finishes with:

```text
done. Code in any git repo with Hackatime running and it shows up on
https://flockatime.curiousengine.org within a couple of minutes.
```

If it says Hackatime is not installed, set Hackatime up and run the same command again.

## 4. Start coding

Open any git repository and edit a file. Within a couple of minutes the project appears under **[Projects](#/projects)**, named the way Hackatime names it.

## Next steps

- [How it works](#/docs/how-it-works): what the agent records and when.
- [Reading a project](#/docs/dashboard-projects): what each number means.
- [Commands](#/docs/cli-commands): `doctor`, `once` and the rest.
