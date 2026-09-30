# Offline queue

Your laptop goes to sleep, the Wi-Fi drops, the server restarts. None of it loses a snapshot.

## How it works

When a send fails (no network, a timeout, any non-2xx answer) the agent writes the batch to its queue file on disk and carries on capturing. On the next successful send it flushes the backlog:

- **oldest first**,
- **up to 200 snapshots per request**,
- with each snapshot's **original `captured_at`**, which is never rewritten.

The queue holds **5,000 snapshots**. Past that the oldest are dropped, so a machine offline for weeks cannot fill your disk.

## Delivery is at least once

If the server stores a batch but the response is lost, the agent sends it again. The server ignores the repeat: snapshots are unique on `(project, captured_at, tree_hash)`.

A malformed record inside a batch is dropped rather than rejected. Any non-2xx answer would make the agent re-queue the whole batch, so rejecting it would wedge the agent into retrying a bad record forever.

## On the dashboard

Replayed snapshots are plotted when they were **captured**, not when they arrived. The server also records when each one was **received**. If any snapshot in the window reached the server more than two minutes after it was captured, the project page says how many were replayed from the queue and how late the latest one arrived.

Settings shows the delay on the most recent snapshot, too.

## Clock skew

`captured_at` comes from your machine's clock. If that clock is wrong, charts will be too. `received_at` comes from the server and is kept alongside, so the difference is visible rather than silently absorbed.
