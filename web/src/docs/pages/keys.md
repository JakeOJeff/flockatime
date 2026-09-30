# Keys and devices

Every machine running the agent has its own key. Keys are how the server knows which account a snapshot belongs to.

## Minting a key

Pressing **Generate install command** on [Extensions](#/extensions) mints a key labelled with the platform and date, such as `Windows · 01/10/2026`, and bakes it into the command.

- The key looks like `flk_` followed by 32 random characters.
- It is shown **once**. The server stores only its SHA-256 hash.
- It exists only in that page's memory. Leave the page and it is gone; mint another if you need it.

You can hold up to 50 active keys. One per machine is the norm.

## Viewing and revoking keys

[Settings](#/settings) lists your active keys with when each was created and last used. **Revoke** cuts that machine off immediately: its next send gets a `401`, and it queues snapshots until it is given a working key.

Revoke a key when you:

- stop using a machine,
- think a key has leaked,
- reinstalled and no longer need the old one.

## Switching a machine's key

Generate a new install command and run it on that machine. It checks the new key, rewrites the config and restarts the agent. Then revoke the old key.

## Keys and accounts

A key writes only into the account that minted it. You see and revoke only your own keys. If an account is removed from the server's allowlist, its keys stop working too, not just its dashboard.
