# Privacy

The agent is built so that a server holding everything it sends still cannot read your code, or even your file names.

## What leaves your machine

| Field | Example | Readable? |
|---|---|---|
| `project` | `flockatime-cli` | Plaintext |
| `git.branch` | `main` | Plaintext |
| `git.head` | `eb4cf53b…` | Commit SHA |
| `captured_at`, `seq`, `saves`, `build_at`, `test_at` | `1788371950`, `42`, … | Times and counts |
| `file_count`, `total_lines`, `total_bytes`, `skipped_files` | `28`, `3800`, … | Counts |
| `git.*` past `branch` | `"modified": 4` | Counts, never paths |
| `os`, `arch`, `capture_ms`, `agent_version` | `windows`, `amd64` | Plaintext |
| `tree_hash`, `prev` | `f397336f865d…` | Hash |
| `files[].path_hash` | `618cd5b8…` | **Salted** hash |
| `files[].content_hash` | `52d9604e…` | Hash |
| `files[].lines`, `bytes`, `mtime` | `10`, `298`, … | Counts |
| `files[].added`, `removed`, `tail`, `mid` | `6`, `1`, … | Line counts |
| `files[].fp` | `[301247718934, …]` | Fingerprints |

The only plaintext strings are the **project name**, the **branch name** and the **commit SHA**. Every field is explained in [What the agent records](#/docs/cli-signals).

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

## Path hashes are salted

Each `path_hash` is an HMAC-SHA256 of the path, keyed with a secret that never leaves your machine: `path_salt` from the config, or a random one created once in `~/.flockatime/path-salt`. Unsalted, the hash of `src/main.rs` would be the same for everyone, and common names could be recovered from a dictionary.

The trade-off: two machines only produce matching path hashes if they share a `path_salt`. Upgrading from 0.2 changes every `path_hash` and `tree_hash` once.

## Line hashes stay local

The per-line hashes behind `added` and `removed` live in `~/.flockatime/state` (mode 600) and are never sent. Only the counts are.

## Fingerprints

Building fingerprints means the file is tokenized in memory; the tokens are hashed and discarded. A 30-token window cannot be turned back into code. Anyone already holding a *candidate* text can fingerprint it and confirm a match, and that is what makes copy detection work. flockatime compares fingerprints only between projects of the same account, never across users.

## Why the dashboard shows hashes, and `reveal`

The server only ever sees path hashes, so it cannot tell you a file's name. Every hash on the dashboard has a **reveal** button that copies a command like:

```sh
snapshot-agent reveal 9d2e4c18a0b1 --project flockatime
```

Run it on the machine that made the snapshot and it prints which file that is. Nothing is sent; whether to share the answer is up to you.

## Keys

- An agent key is shown once, when it is minted. The server stores only its SHA-256, so a leaked database is not a leaked key.
- The installer passes the key through the `FLOCKATIME_KEY` environment variable, never the command line, where other processes could read it.
- On macOS and Linux the config file holding the key must be `chmod 600`. The agent refuses to start otherwise.
- The agent refuses plain `http://` endpoints unless they are on localhost, so a key is never sent unencrypted.

## Updates

The agent updates itself from the GitHub releases of its repository. Every download is checked against the release's `SHA256SUMS`, and the new binary must run `version` correctly before it replaces the old one. Set `auto_update = false` to pin a version.

## Hackatime

The server fetches your Hackatime stats, not your browser, so no Hackatime key reaches the page. Unless you are the server's owner, only your **public** Hackatime stats are read.
