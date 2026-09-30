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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (res.status === 401) {
    onSignedOut();
    throw new SignedOutError('signed out');
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()) as T;
}

/** `auth: false` means the server has sign-in turned off (local dev). */
export const getMe = () =>
  get<{ auth: boolean; user: { email: string; name: string | null } | null }>('/auth/me');

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
