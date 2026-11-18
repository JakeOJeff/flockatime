#!/usr/bin/env node
// Writes SQL that fills the LOCAL database with three weeks of made-up
// snapshots for a few "sample-*" projects, so every chart has something to
// draw without an agent running. Re-running replaces the sample projects and
// leaves real ones alone. Never point this at --remote.
//
//   node scripts/seed-local.mjs > seed.sql
//   npx wrangler d1 execute flockatime --local --file=./seed.sql && rm seed.sql

const ACCOUNT = 'local';
const DAYS = 21;
const TICK = 120; // the agent's default interval
const PROJECTS = [
  { name: 'sample-api', lines: 8200, files: 64, workDays: 0.8, hours: [9, 14] },
  { name: 'sample-web', lines: 15400, files: 130, workDays: 0.6, hours: [19, 23] },
  { name: 'sample-cli', lines: 2100, files: 18, workDays: 0.35, hours: [11, 17] },
];

// Seeded PRNG so the sample data is the same on every run.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (lo, hi) => Math.floor(lo + rand() * (hi - lo));
const hex = (n) => Array.from({ length: n }, () => pick(0, 16).toString(16)).join('');

const now = Math.floor(Date.now() / 1000);
const out = [];
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

out.push(
  `DELETE FROM snapshots WHERE project_id IN (SELECT id FROM projects WHERE account_id = ${q(ACCOUNT)} AND name LIKE 'sample-%');`,
  `DELETE FROM projects WHERE account_id = ${q(ACCOUNT)} AND name LIKE 'sample-%';`,
);

for (const p of PROJECTS) {
  out.push(
    `INSERT INTO projects (account_id, name, created_at) VALUES (${q(ACCOUNT)}, ${q(p.name)}, ${now - DAYS * 86400});`,
  );
  const pid = `(SELECT id FROM projects WHERE account_id = ${q(ACCOUNT)} AND name = ${q(p.name)})`;

  let lines = p.lines;
  let files = p.files;
  let head = hex(40);
  let branch = 'main';
  const rows = [];

  for (let d = DAYS; d >= 0; d--) {
    if (rand() > p.workDays) continue;
    const midnight = now - d * 86400 - (now % 86400);
    // One to three sessions a day inside the project's usual hours.
    const sessions = pick(1, 4);
    for (let s = 0; s < sessions; s++) {
      let t = midnight + pick(p.hours[0], p.hours[1]) * 3600 + pick(0, 3600);
      if (t > now) continue;
      const ticks = pick(8, 60);
      if (rand() < 0.3) head = hex(40);
      if (rand() < 0.15) branch = rand() < 0.5 ? 'main' : `feature/${hex(4)}`;
      for (let i = 0; i < ticks && t <= now; i++, t += TICK) {
        const unchanged = rand() < 0.35 ? 1 : 0;
        const delta = unchanged ? 0 : pick(-25, 60);
        const added = unchanged ? 0 : rand() < 0.08 ? 1 : 0;
        const removed = unchanged ? 0 : rand() < 0.03 ? 1 : 0;
        const modified = unchanged ? 0 : pick(1, 4);
        lines = Math.max(100, lines + delta);
        files += added - removed;
        rows.push(
          `(${pid}, ${t}, ${t + pick(0, 2)}, ${q(hex(64))}, ${files}, ${lines}, ${unchanged}, ` +
            `${added}, ${removed}, ${modified}, ${delta}, ${q(head)}, ${q(branch)}, ${rand() < 0.6 ? 1 : 0}, ${pick(0, 3)}, 'sample')`,
        );
      }
    }
  }

  // Batched so the file stays small and D1 takes it in one go.
  for (let i = 0; i < rows.length; i += 200) {
    out.push(
      `INSERT OR IGNORE INTO snapshots (project_id, captured_at, received_at, tree_hash, file_count, total_lines, unchanged, ` +
        `files_added, files_removed, files_modified, lines_delta, git_head, git_branch, git_dirty, git_ahead, agent_version) VALUES\n` +
        rows.slice(i, i + 200).join(',\n') +
        ';',
    );
  }
}

process.stdout.write(out.join('\n') + '\n');
