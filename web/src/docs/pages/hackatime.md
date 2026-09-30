# Hackatime

flockatime shows your [Hackatime](https://hackatime.hackclub.com) editor time next to what the agent records. The server fetches it for you; there is nothing to paste into the dashboard.

## How your stats are found

For most people it just works: Hackatime can look you up by your Hack Club Auth id, the same one you signed in with. That reads your **public** stats.

The server's owner can configure two extra options that apply only to them:

1. `HACKATIME_API_KEY`: the owner's own Hackatime key, which reads private stats too.
2. `HACKATIME_USER`: a Hackatime username or Slack ID, for public stats.

[Settings](#/settings) shows which one your account uses.

## If it is not connecting

| Problem | Fix |
|---|---|
| No account matching your sign-in | Sign in to Hackatime with the same Hack Club account |
| Stats are private | Make your stats public in Hackatime's settings |
| Key rejected | (Owner) Check `HACKATIME_API_KEY` on hackatime.hackclub.com |
| Could not be reached | Hackatime is down or slow. Change the date range to retry |

Hackatime is fetched once when the dashboard loads and again when you change the date range. It is never polled, so a fix shows up on the next reload.

## Matching projects

Hackatime time is account-wide. To show a project's editor time on its project page, flockatime matches the Hackatime project to the agent's project **by name**, ignoring case.

The agent names projects the way Hackatime does, so they normally line up. If one does not:

- check both names in the **Hackatime projects** table on the Projects page,
- add a `.wakatime-project` file to the repository root with the name you want. Both Hackatime and the agent read it.

## What Hackatime is used for

- Home: total time, top project, languages, editors, operating systems and categories, and daily time.
- Project pages: editor time for that project, and account-wide daily totals beside active time.

The agent also depends on Hackatime locally: it reads the WakaTime debug log to learn which repository you are editing. See [Configuration](#/docs/cli-config#following-hackatime).
