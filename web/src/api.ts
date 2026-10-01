export interface ProjectRow {
  name: string;
  captured_at: number | null;
  received_at: number | null;
  file_count: number | null;
  total_lines: number | null;
  tree_hash: string | null;
  git_head: string | null;
  git_branch: string | null;
  git_dirty: number | null;
  git_ahead: number | null;
  agent_version: string | null;
}

export interface SnapshotRow {
  captured_at: number;
  received_at: number;
  file_count: number;
  total_lines: number;
  unchanged: number;
  files_added: number | null;
  files_removed: number | null;
  files_modified: number | null;
  lines_delta: number | null;
  git_head: string | null;
  git_branch: string | null;
  git_dirty: number | null;
  git_ahead: number | null;
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
  ever_dirty: number | null;
}

export interface ChurnRow {
  path_hash: string;
  revisions: number;
  lines_moved: number;
  lines: number;
}

export interface SessionRow {
  started_at: number;
  ended_at: number;
  seconds: number;
  ticks: number;
  lines_added: number;
  lines_removed: number;
  files_touched: number;
}

export interface DailyRow {
  day: string;
  active_ticks: number | null;
  lines_added: number | null;
  lines_removed: number | null;
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
    first_seen: number | null;
    last_seen: number | null;
  } | null;
  daily: DailyRow[];
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

export const listProjects = () => get<{ projects: ProjectRow[] }>('/api/projects');

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
  get<{ files: ChurnRow[]; trees_compared: number }>(
    `/api/projects/${encodeURIComponent(name)}/churn?days=${days}`,
  );

export const getCommits = (name: string, days: number) =>
  get<{ commits: CommitRow[] }>(`/api/projects/${encodeURIComponent(name)}/commits?days=${days}`);

/* ---------- formatting ---------- */

export function humanDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
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
