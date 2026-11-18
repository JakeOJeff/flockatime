export type Chain = 'ok' | 'start' | 'restart' | 'gap' | 'fork';

/**
 * The state at one snapshot. Everything past the original five git fields is
 * null from agents before 0.2.2 / 0.3.0, which did not send it.
 */
export interface StateRow {
  captured_at: number | null;
  received_at: number | null;
  file_count: number | null;
  total_lines: number | null;
  total_bytes: number | null;
  skipped_files: number | null;
  capture_ms: number | null;
  os: string | null;
  arch: string | null;
  agent_version: string | null;
  tree_hash: string | null;
  git_head: string | null;
  git_branch: string | null;
  git_dirty: number | null;
  git_ahead: number | null;
  git_behind: number | null;
  git_staged: number | null;
  git_modified: number | null;
  git_untracked: number | null;
  git_conflicted: number | null;
  git_insertions: number | null;
  git_deletions: number | null;
  git_commits: number | null;
  git_last_commit_at: number | null;
  git_stashes: number | null;
  seq: number | null;
  chain: Chain | null;
  build_at: number | null;
  test_at: number | null;
}

export interface ProjectRow extends StateRow {
  name: string;
  /** Snapshot CLI active time (summed sessions) in the requested window. */
  active_seconds: number;
  /** What happened in the requested window. */
  window: {
    snapshots: number;
    lines_added: number | null;
    lines_removed: number | null;
    saves: number | null;
    builds: number;
    tests: number;
    chain_breaks: number;
  };
}

export interface SnapshotRow extends StateRow {
  captured_at: number;
  received_at: number;
  file_count: number;
  total_lines: number;
  unchanged: number;
  files_added: number | null;
  files_removed: number | null;
  files_modified: number | null;
  lines_delta: number | null;
  lines_added: number | null;
  lines_removed: number | null;
  tail_edits: number | null;
  mid_edits: number | null;
  save_count: number | null;
  fp_files: number | null;
}

/** One commit's worth of work: the span during which it was HEAD. */
export interface CommitRow {
  git_head: string;
  git_branch: string | null;
  first_seen: number;
  last_seen: number;
  seconds: number;
  ticks: number;
  active_ticks: number | null;
  lines_added: number | null;
  lines_removed: number | null;
  files_touched: number | null;
  saves: number | null;
  /** When this commit was made, from git (agent 0.2.2+). */
  committed_at: number | null;
  ever_dirty: number | null;
}

export interface ChurnRow {
  path_hash: string;
  revisions: number;
  lines_moved: number;
  lines: number;
  /** Present when ranked from true per-file diffs (agent 0.3+). */
  added?: number;
  removed?: number;
  tail?: number;
  mid?: number;
  last_edit?: number;
}

export interface Churn {
  files: ChurnRow[];
  /** 'edits': true line diffs; 'trees': net line change between stored file lists. */
  source: 'edits' | 'trees';
  trees_compared: number;
}

export interface OverlapPair {
  path_hash: string;
  lines: number;
  prints: number;
  other_project: string;
  other_path_hash: string;
  other_lines: number;
  shared: number;
}

export interface Overlap {
  pairs: OverlapPair[];
  files_fingerprinted: number;
  files_compared: number;
}

export interface SessionRow {
  started_at: number;
  ended_at: number;
  seconds: number;
  ticks: number;
  lines_added: number;
  lines_removed: number;
  files_touched: number;
  saves: number;
}

export interface DailyRow {
  day: string;
  active_ticks: number | null;
  lines_added: number | null;
  lines_removed: number | null;
  saves: number | null;
}

export interface ChainBreak {
  captured_at: number;
  seq: number;
  chain: 'gap' | 'fork' | 'restart';
}

export interface SavesByHour {
  hours: number[];
  total: number;
  longest_gap_in_session: number;
}

export interface AgentRow {
  os: string | null;
  arch: string | null;
  agent_version: string | null;
  projects: number;
  snapshots: number;
  last_seen: number;
  avg_capture_ms: number | null;
}

export interface Summary {
  totals: {
    ticks: number | null;
    active_ticks: number | null;
    lines_added: number | null;
    lines_removed: number | null;
    files_touched: number | null;
    /** Snapshots that arrived from the offline queue rather than live. */
    delayed_ticks: number | null;
    max_lag_seconds: number | null;
    files_added: number | null;
    files_removed: number | null;
    files_modified: number | null;
    commits: number | null;
    branches: number | null;
    /** Sum of true added lines only; null when every line count is a net estimate. */
    exact_added: number | null;
    tail_edits: number | null;
    mid_edits: number | null;
    saves: number | null;
    builds: number;
    tests: number;
    last_build_at: number | null;
    last_test_at: number | null;
    fingerprinted_files: number | null;
    avg_capture_ms: number | null;
    max_capture_ms: number | null;
    /** Growth of git's commit count over the window. */
    commits_made: number | null;
    /** Snapshots that carried a seq number. */
    chained: number;
    chain_gaps: number | null;
    chain_forks: number | null;
    chain_restarts: number | null;
    first_seen: number | null;
    last_seen: number | null;
  } | null;
  daily: DailyRow[];
  breaks: ChainBreak[];
  lag_threshold_seconds: number;
}

/** One weekday × hour cell. dow 0 = Sunday, in the viewer's timezone. */
export interface RhythmCell {
  dow: number;
  hour: number;
  active_ticks: number;
  lines_moved: number;
}

export interface HackatimeSlice {
  name: string;
  total_seconds: number;
  percent: number;
}

export type Hackatime =
  | { configured: false }
  | {
      configured: true;
      source: 'api_key' | 'username' | 'hack_club';
      error: 'not_found' | 'private' | 'bad_key' | 'unavailable';
    }
  | {
      configured: true;
      source: 'api_key' | 'username' | 'hack_club';
      error?: undefined;
      username: string | null;
      total_seconds: number;
      daily_average: number;
      streak: number;
      languages: HackatimeSlice[];
      projects: HackatimeSlice[];
      editors: HackatimeSlice[];
      operating_systems: HackatimeSlice[];
      categories: HackatimeSlice[];
      daily: { day: string; seconds: number }[];
      /** Seconds per local hour of day, 0–23. */
      hours: number[];
    };

/** The viewer's UTC offset in minutes, so the server cuts days where they do. */
const tz = () => -new Date().getTimezoneOffset();

/** The session is gone (signed out, expired, or removed from the allowlist). */
export class SignedOutError extends Error {}

/** Called on any 401, so the app can drop to the logged-out screen. */
let onSignedOut: () => void = () => undefined;
export const setSignedOutHandler = (fn: () => void) => {
  onSignedOut = fn;
};

/**
 * The account an admin is viewing the dashboard as, or null for their own.
 * Sent as a header on every non-admin call; the server ignores it from anyone
 * who is not an admin. Kept for the tab, so a reload stays on the same user.
 */
const VIEW_AS_KEY = 'fk_view_as';
export interface ViewAs {
  id: string;
  name: string | null;
  email: string | null;
}
let viewAs: ViewAs | null = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(VIEW_AS_KEY) ?? 'null') as ViewAs | null;
  } catch {
    return null;
  }
})();
export const getViewAs = () => viewAs;
export function setViewAs(v: ViewAs | null) {
  viewAs = v;
  try {
    if (v) sessionStorage.setItem(VIEW_AS_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(VIEW_AS_KEY);
  } catch {
    // Only lost on reload.
  }
}

function headers(path: string, extra: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { accept: 'application/json', ...extra };
  if (viewAs && !path.startsWith('/api/admin')) h['x-flockatime-as'] = viewAs.id;
  return h;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: headers(path, {}) });
  if (res.status === 401) {
    onSignedOut();
    throw new SignedOutError('signed out');
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()) as T;
}

/** `auth: false` means the server has sign-in turned off (local dev). */
export const getMe = () =>
  get<{ auth: boolean; user: { email: string; name: string | null } | null; admin?: boolean }>('/auth/me');

export const listProjects = (days = 7) => get<{ projects: ProjectRow[] }>(`/api/projects?days=${days}`);

export const getTimeline = (name: string, days: number) =>
  get<{ snapshots: SnapshotRow[] }>(`/api/projects/${encodeURIComponent(name)}/timeline?days=${days}`);

export const getSummary = (name: string, days: number) =>
  get<Summary>(`/api/projects/${encodeURIComponent(name)}/summary?days=${days}&tz=${tz()}`);

export const getRhythm = (name: string, days: number) =>
  get<{ cells: RhythmCell[] }>(
    `/api/projects/${encodeURIComponent(name)}/rhythm?days=${days}&tz=${tz()}`,
  );

export const getHackatime = (days: number) => get<Hackatime>(`/api/hackatime?days=${days}&tz=${tz()}`);

export const getSessions = (name: string, days: number) =>
  get<{ sessions: SessionRow[]; gap_seconds: number }>(
    `/api/projects/${encodeURIComponent(name)}/sessions?days=${days}`,
  );

export const getChurn = (name: string, days: number) =>
  get<Churn>(`/api/projects/${encodeURIComponent(name)}/churn?days=${days}`);

export const getOverlap = (name: string) => get<Overlap>(`/api/projects/${encodeURIComponent(name)}/overlap`);

export const getSaves = (name: string, days: number) =>
  get<SavesByHour>(`/api/projects/${encodeURIComponent(name)}/saves?days=${days}&tz=${tz()}`);

export const listAgents = (days = 30) => get<{ agents: AgentRow[] }>(`/api/agents?days=${days}`);

/** Newest agent version among those given, by X.Y.Z. */
export function newestVersion(versions: (string | null | undefined)[]): string | null {
  const cmp = (x: string, y: string) => {
    const [a, b] = [x.split('.').map(Number), y.split('.').map(Number)];
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  };
  let best: string | null = null;
  for (const v of versions) {
    if (v && /^\d+\.\d+\.\d+$/.test(v) && (!best || cmp(v, best) > 0)) best = v;
  }
  return best;
}

/** "3 hours ago"-style relative time. */
export function ago(unix: number | null | undefined): string {
  if (!unix) return '—';
  const s = Math.max(0, Date.now() / 1000 - unix);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString()}`;

export const getCommits = (name: string, days: number) =>
  get<{ commits: CommitRow[] }>(`/api/projects/${encodeURIComponent(name)}/commits?days=${days}`);

/* ---------- formatting ---------- */

export function humanDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  // Round to whole minutes first, so 59.6 minutes becomes the next hour, not "60m".
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export const num = (v: number | null | undefined) => (v ?? 0).toLocaleString();

/** Short commit sha, the length git itself abbreviates to. */
export const shortSha = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : '—');

export const clock = (unix: number) =>
  new Date(unix * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const dayLabel = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  // Built at UTC midnight, so format in UTC too — otherwise anyone west of
  // Greenwich sees the previous day.
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
};

/** YYYY-MM-DD for a unix time, in the viewer's timezone. */
export const localDay = (unix: number) => {
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Every local day in the last `days` days, oldest first, so empty days still plot. */
export function dayRange(days: number): string[] {
  const out: string[] = [];
  const now = Date.now() / 1000;
  for (let i = days - 1; i >= 0; i--) out.push(localDay(now - i * 86400));
  return [...new Set(out)];
}

/** Hours for an axis: whole when it is whole ("6h", not "6.0h"), else one decimal. */
export const hours = (seconds: number) => `${Number((seconds / 3600).toFixed(1))}h`;

/* ---------- agent keys ---------- */

export interface ApiKeyRow {
  id: string;
  label: string | null;
  created_at: number;
  last_used: number | null;
  revoked_at: number | null;
}

export const listKeys = () => get<{ keys: ApiKeyRow[] }>('/api/keys');

async function send<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown): Promise<T> {
  // JSON on purpose: the server refuses writes without it (CSRF guard).
  const res = await fetch(path, {
    method,
    headers: headers(path, { 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    onSignedOut();
    throw new SignedOutError('signed out');
  }
  if (!res.ok) {
    // Admin routes explain refusals ("that account already has…"); say so.
    const msg = await res
      .json()
      .then((j) => (j as { error?: string }).error)
      .catch(() => undefined);
    throw new Error(msg ?? `${path} -> ${res.status}`);
  }
  return (await res.json()) as T;
}

export const createKey = (label: string) => send<{ token: string }>('POST', '/api/keys', { label });

export const revokeKey = (id: string) => send<{ ok: true }>('DELETE', `/api/keys/${id}`, {});

/* ---------- admin ---------- */

export interface AdminOverview {
  accounts: number;
  disabled: number;
  projects: number;
  snapshots: number;
  snapshots_24h: number;
  active_24h: number;
  active_keys: number;
  trees: number;
  stored_bytes: number;
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  name: string | null;
  created_at: number | null;
  last_login: number | null;
  disabled_at: number | null;
  projects: number;
  snapshots: number;
  last_received: number | null;
  active_keys: number;
  /** What this email may do right now; null = cannot sign in. */
  role: Role | null;
  last_key_use: number | null;
}

export interface AdminProjectRow {
  name: string;
  created_at: number;
  snapshots: number;
  captured_at: number | null;
  received_at: number | null;
  file_count: number | null;
  total_lines: number | null;
  git_branch: string | null;
  git_head: string | null;
  git_dirty: number | null;
  agent_version: string | null;
}

export interface AdminUser {
  id: string;
  account: {
    id: string;
    email: string;
    name: string | null;
    created_at: number;
    last_login: number;
    disabled_at: number | null;
  } | null;
  totals: {
    snapshots: number;
    active_snapshots: number | null;
    snapshots_7d: number | null;
    lines_added: number | null;
    lines_removed: number | null;
    first_seen: number | null;
    last_received: number | null;
    trees: number;
    stored_bytes: number;
  } | null;
  projects: AdminProjectRow[];
  keys: ApiKeyRow[];
}

export interface AdminSnapshotRow extends SnapshotRow {
  id: number;
  project: string;
  tree_hash: string;
  agent_version: string | null;
}

const enc = encodeURIComponent;
const user = (id: string) => `/api/admin/users/${enc(id)}`;

export const admin = {
  overview: () => get<AdminOverview>('/api/admin/overview'),
  users: () => get<{ users: AdminUserRow[] }>('/api/admin/users'),
  user: (id: string) => get<AdminUser>(user(id)),
  snapshots: (id: string, opts: { project?: string; before?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (opts.project) q.set('project', opts.project);
    if (opts.before) q.set('before', String(opts.before));
    if (opts.limit) q.set('limit', String(opts.limit));
    return get<{ snapshots: AdminSnapshotRow[]; more: boolean }>(`${user(id)}/snapshots?${q}`);
  },
  createUser: (b: { id?: string; email: string; name?: string }) => send<{ id: string }>('POST', '/api/admin/users', b),
  updateUser: (id: string, b: { email?: string; name?: string; disabled?: boolean }) =>
    send<{ ok: true }>('PATCH', user(id), b),
  deleteUser: (id: string) => send<{ ok: true }>('DELETE', user(id), {}),
  mintKey: (id: string, label: string) => send<{ token: string }>('POST', `${user(id)}/keys`, { label }),
  updateKey: (key: string, b: { label?: string; revoked?: boolean }) =>
    send<{ ok: true }>('PATCH', `/api/admin/keys/${enc(key)}`, b),
  deleteKey: (key: string) => send<{ ok: true }>('DELETE', `/api/admin/keys/${enc(key)}`, {}),
  updateProject: (id: string, name: string, b: { name?: string; to?: string }) =>
    send<{ ok: true }>('PATCH', `${user(id)}/projects/${enc(name)}`, b),
  deleteProject: (id: string, name: string) => send<{ ok: true }>('DELETE', `${user(id)}/projects/${enc(name)}`, {}),
  deleteSnapshot: (sid: number) => send<{ ok: true }>('DELETE', `/api/admin/snapshots/${sid}`, {}),
};

export const bytes = (n: number | null | undefined) => {
  const v = n ?? 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 ** 2) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  return `${(v / 1024 ** 3).toFixed(2)} GB`;
};

export type Role = 'user' | 'admin';

export interface AccessRow {
  entry: string;
  role: Role;
  added_by: string | null;
  created_at: number;
}

export const access = {
  list: () => get<{ entries: AccessRow[]; config: { allowed: string[]; admins: string[] } }>('/api/admin/access'),
  check: (email: string) =>
    get<{ role: Role | null; entry: { entry: string; role: Role } | null; other: boolean; config_admin?: boolean }>(
      `/api/admin/access/check?email=${enc(email)}`,
    ),
  set: (entry: string, role: Role) => send<{ ok: true }>('POST', '/api/admin/access', { entry, role }),
  remove: (entry: string) => send<{ ok: true }>('DELETE', `/api/admin/access/${enc(entry)}`, {}),
};
