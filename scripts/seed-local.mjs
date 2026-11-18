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
  `DELETE FROM file_edits WHERE project_id IN (SELECT id FROM projects WHERE account_id = ${q(ACCOUNT)} AND name LIKE 'sample-%');`,
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
  let seq = 0;
  let commits = pick(20, 200);
  let build = 0;
  let test = 0;
  const rows = [];
  const edits = [];
  const paths = Array.from({ length: p.files }, () => hex(64));

  for (let d = DAYS; d >= 0; d--) {
    if (rand() > p.workDays) continue;
    const midnight = now - d * 86400 - (now % 86400);
    // One to three sessions a day inside the project's usual hours.
    const sessions = pick(1, 4);
    for (let s = 0; s < sessions; s++) {
      let t = midnight + pick(p.hours[0], p.hours[1]) * 3600 + pick(0, 3600);
      if (t > now) continue;
      const ticks = pick(8, 60);
      if (rand() < 0.3) {
        head = hex(40);
        commits++;
      }
      if (rand() < 0.15) branch = rand() < 0.5 ? 'main' : `feature/${hex(4)}`;
      for (let i = 0; i < ticks && t <= now; i++, t += TICK) {
        const unchanged = rand() < 0.35 ? 1 : 0;
        const delta = unchanged ? 0 : pick(-25, 60);
        const added = unchanged ? 0 : rand() < 0.08 ? 1 : 0;
        const removed = unchanged ? 0 : rand() < 0.03 ? 1 : 0;
        const modified = unchanged ? 0 : pick(1, 4);
        lines = Math.max(100, lines + delta);
        files += added - removed;
        // True line diffs: a rewrite shows on both sides, so they exceed the net delta.
        const plus = unchanged ? 0 : Math.max(delta, 0) + pick(0, 12);
        const minus = plus - delta;
        const tail = Math.round((plus + minus) * (0.3 + rand() * 0.5));
        const saves = unchanged ? pick(0, 2) : pick(1, 9);
        if (rand() < 0.1) {
          build = t - pick(0, 60);
          test = build - pick(0, 600);
        }
        seq++;
        const chain = seq === 1 ? 'start' : rand() < 0.004 ? 'gap' : 'ok';
        if (chain === 'gap') seq++;
        const saveTimes = Array.from({ length: saves }, () => t - pick(0, TICK)).sort();
        const dirty = rand() < 0.6 ? 1 : 0;
        const tree = dirty
          ? [pick(0, 3), pick(1, 6), pick(0, 3), pick(5, 200), pick(0, 60)]
          : [0, 0, pick(0, 3), 0, 0]; // staged, modified, untracked, insertions, deletions
        rows.push(
          `(${pid}, ${t}, ${t + pick(0, 2)}, ${q(hex(64))}, ${files}, ${lines}, ${unchanged}, ` +
            `${added}, ${removed}, ${modified}, ${delta}, ${q(head)}, ${q(branch)}, ${dirty}, ${pick(0, 3)}, '0.3.0', ` +
            `${lines * 38}, ${pick(0, 2)}, ${pick(20, 140)}, 'windows', 'amd64', 0, ${tree[0]}, ${tree[1]}, ${tree[2]}, 0, ` +
            `${tree[3]}, ${tree[4]}, ${commits}, ${t - pick(600, 7200)}, ${pick(0, 2)}, ` +
            `${plus}, ${minus}, ${tail}, ${plus + minus - tail}, ${seq}, ${q(chain)}, ${saves}, ${q(JSON.stringify(saveTimes))}, ` +
            `${build || 'NULL'}, ${test || 'NULL'}, ${unchanged ? 0 : modified})`,
        );
        if (!unchanged) {
          const share = (x) => Math.round(x / modified);
          for (let m = 0; m < modified; m++) {
            edits.push(
              `(${pid}, ${t}, ${q(paths[pick(0, paths.length)])}, ${share(plus)}, ${share(minus)}, ` +
                `${share(tail)}, ${share(plus + minus - tail)}, ${pick(30, 600)})`,
            );
          }
        }
      }
    }
  }

  // Batched so the file stays small and D1 takes it in one go.
  for (let i = 0; i < rows.length; i += 200) {
    out.push(
      `INSERT OR IGNORE INTO snapshots (project_id, captured_at, received_at, tree_hash, file_count, total_lines, unchanged, ` +
        `files_added, files_removed, files_modified, lines_delta, git_head, git_branch, git_dirty, git_ahead, agent_version, ` +
        `total_bytes, skipped_files, capture_ms, os, arch, git_behind, git_staged, git_modified, git_untracked, git_conflicted, ` +
        `git_insertions, git_deletions, git_commits, git_last_commit_at, git_stashes, lines_added, lines_removed, tail_edits, ` +
        `mid_edits, seq, chain, save_count, save_times, build_at, test_at, fp_files) VALUES\n` +
        rows.slice(i, i + 200).join(',\n') +
        ';',
    );
  }
  for (let i = 0; i < edits.length; i += 200) {
    out.push(
      `INSERT OR IGNORE INTO file_edits (project_id, captured_at, path_hash, added, removed, tail, mid, lines) VALUES\n` +
        edits.slice(i, i + 200).join(',\n') +
        ';',
    );
  }
}

process.stdout.write(out.join('\n') + '\n');
