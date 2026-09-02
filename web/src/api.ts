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
  } | null;
  daily: DailyRow[];
  lag_threshold_seconds: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export const listProjects = () => get<{ projects: ProjectRow[] }>('/api/projects');

export const getTimeline = (name: string, days: number) =>
  get<{ snapshots: SnapshotRow[] }>(`/api/projects/${encodeURIComponent(name)}/timeline?days=${days}`);

export const getSummary = (name: string, days: number) =>
  get<Summary>(`/api/projects/${encodeURIComponent(name)}/summary?days=${days}`);

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
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};
