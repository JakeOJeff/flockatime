#!/usr/bin/env node
// Mints an agent API key. Prints the token once (it is never stored) and the
// SQL that registers its hash.
//
//   node scripts/new-key.mjs "laptop"
//   node scripts/new-key.mjs "laptop" | wrangler d1 execute flockatime --local --file=-

import { randomBytes, createHash } from 'node:crypto';

const label = (process.argv[2] ?? 'default').replace(/'/g, "''");
const token = 'flk_' + randomBytes(24).toString('base64url');
const hash = createHash('sha256').update(token).digest('hex');
const now = Math.floor(Date.now() / 1000);

process.stderr.write(`\nAPI key (shown once — put it in agent.toml):\n\n  ${token}\n\n`);
process.stdout.write(
  `INSERT INTO api_keys (key_hash, account_id, label, created_at) ` +
    `VALUES ('${hash}', 'local', '${label}', ${now});\n`,
);
