export interface ProjectRow {
  name: string;
  captured_at: number | null;
  file_count: number | null;
  total_lines: number | null;
  tree_hash: string | null;
  git_branch: string | null;
  git_dirty: number | null;
  git_ahead: number | null;
  agent_version: string | null;
}

export interface SnapshotRow {
  captured_at: number;
  file_count: number;
  total_lines: number;
  unchanged: number;
  files_added: number | null;
  files_removed: number | null;
  files_modified: number | null;
  lines_delta: number | null;
  git_branch: string | null;
  git_dirty: number | null;
  git_ahead: number | null;
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
  } | null;
  daily: DailyRow[];
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
  get<{ files: { path_hash: string; revisions: number }[]; trees_compared: number }>(
    `/api/projects/${encodeURIComponent(name)}/churn?days=${days}`,
  );

/* ---------- formatting ---------- */

export function humanDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export const num = (v: number | null | undefined) => (v ?? 0).toLocaleString();

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
