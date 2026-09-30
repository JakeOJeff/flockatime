# flockatime Documentation

Coding time *and* the shape of your code, on one dashboard. Hackatime tells you how long you spent in your editor; flockatime's snapshot agent tells you what that time did to the project.

Get the agent running on your machine, learn to read the dashboard, or run your own server.

```cards
rocket | Quick start | Set up flockatime in a few minutes. | quick-start
terminal | Install the CLI | One command on Windows, macOS or Linux. | install-windows
sliders | Configuration | Tune the agent's interval, projects and queue. | cli-config
chart | Reading the dashboard | What every tile and chart means. | dashboard-projects
server | Self-hosting | Run flockatime on your own Cloudflare account. | self-host
lifebuoy | Troubleshooting | Solve common setup problems. | troubleshooting
```

## Platform guides

```platforms
windows | Windows | Install with one PowerShell command. | install-windows
apple | macOS | Runs as a LaunchAgent at every login. | install-macos
linux | Linux | Runs as a systemd user unit. | install-linux
```

Hackatime is the only prerequisite. The agent follows it, so there is no project list to keep.

## Two sources, one dashboard

| | Hackatime | snapshot-agent |
|---|---|---|
| Measures | Time in your editor | The project tree itself |
| Comes from | Editor plugins, via hackatime.hackclub.com | The CLI on your machine, sent to this server |
| Powers | Home: time, languages, editors, OS | Projects: lines, churn, sessions, commits |
| Sees | Heartbeats (file, language, editor) | Line counts and hashes, never contents or names |

Read [How it works](#/docs/how-it-works) for the full picture, or [Privacy](#/docs/privacy) for exactly what leaves your machine.

## Still need help?

If something is not working, read the [troubleshooting guide](#/docs/troubleshooting), run `snapshot-agent doctor`, or [open an issue](https://github.com/JakeOJeff/flockatime/issues).
