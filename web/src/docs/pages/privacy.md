# Privacy

The agent is built so that a server holding everything it sends still cannot read your code.

## What leaves your machine

Every snapshot contains:

| Field | Example | Readable? |
|---|---|---|
| `project` | `flockatime-cli` | Plaintext |
| `captured_at` | `1788371950` | Plaintext |
| `tree_hash` | `f397336f865d…` | Hash |
| `file_count`, `total_lines` | `28`, `3800` | Plaintext |
| `git.branch` | `main` | Plaintext |
| `git.head` | `eb4cf53b…` | Commit SHA |
| `git.dirty`, `git.ahead` | `false`, `0` | Plaintext |
| `files[].path_hash` | `618cd5b8…` | Hash |
| `files[].content_hash` | `52d9604e…` | Hash |
| `files[].lines`, `bytes`, `mtime` | `10`, `298`, … | Plaintext |

The only plaintext strings are the **project name**, the **branch name** and the **commit SHA**.

## What never leaves your machine

- File contents
- File names and folder names
- Keystrokes
- Window titles or process lists
- Screenshots or the clipboard

You can check this yourself. Run the agent on a repository and search the output for one of your file names:

```sh
snapshot-agent once .
```

It prints exactly what would be sent, and sends nothing.

## Why "Most-revised files" shows hashes

The server only ever sees path hashes, so it cannot tell you a file's name. To map a hash back, run `snapshot-agent once` in the repository and find the `path_hash` in its output. Only someone with the code can do that.

## Keys

- An agent key is shown once, when it is minted. The server stores only its SHA-256, so a leaked database is not a leaked key.
- The installer passes the key through the `FLOCKATIME_KEY` environment variable, never the command line, where other processes could read it.
- On macOS and Linux the config file holding the key must be `chmod 600`. The agent refuses to start otherwise.
- The agent refuses plain `http://` endpoints unless they are on localhost, so a key is never sent unencrypted.

## Hackatime

The server fetches your Hackatime stats, not your browser, so no Hackatime key reaches the page. Unless you are the server's owner, only your **public** Hackatime stats are read.
