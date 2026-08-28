import { useEffect, useState } from 'react';
import {
  clock,
  getChurn,
  getSessions,
  getSummary,
  getTimeline,
  humanDuration,
  listProjects,
  num,
  type ProjectRow,
  type SessionRow,
  type SnapshotRow,
  type Summary,
} from './api';
import { TotalLines } from './charts/TotalLines';
import { Churn } from './charts/Churn';

const RANGES = [1, 7, 30, 90];
const POLL_MS = 10_000;

export default function App() {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  const [timeline, setTimeline] = useState<SnapshotRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [hot, setHot] = useState<{ path_hash: string; revisions: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);

  useEffect(() => {
    listProjects()
      .then((r) => {
        setProjects(r.projects);
        setSelected((cur) => cur ?? r.projects[0]?.name ?? null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Full load, including churn — that endpoint walks trees out of R2, so it is
  // only refetched when the project or the window actually changes.
  useEffect(() => {
    if (!selected) return;
    let live = true;
    setError(null);

    Promise.all([
      getTimeline(selected, days),
      getSummary(selected, days),
      getSessions(selected, days),
      getChurn(selected, days),
    ])
      .then(([t, s, ss, c]) => {
        if (!live) return;
        setTimeline(t.snapshots);
        setSummary(s);
        setSessions(ss.sessions);
        setHot(c.files);
      })
      .catch((e) => live && setError(String(e)));

    return () => {
      live = false;
    };
  }, [selected, days]);

  // The agent ticks on its own schedule, so poll the pure-D1 endpoints and let
  // the page keep up with it. Paused while the tab is hidden.
  useEffect(() => {
    if (!selected) return;
    let live = true;

    const poll = async () => {
      if (document.hidden) return;
      try {
        const [t, s, ss, p] = await Promise.all([
          getTimeline(selected, days),
          getSummary(selected, days),
          getSessions(selected, days),
          listProjects(),
        ]);
        if (!live) return;
        setTimeline(t.snapshots);
        setSummary(s);
        setSessions(ss.sessions);
        setProjects(p.projects);
        setLastSync(Date.now());
      } catch {
        // A missed poll is not worth showing; the next one will catch up.
      }
    };

    const id = setInterval(poll, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [selected, days]);

  const current = projects?.find((p) => p.name === selected) ?? null;
  const totals = summary?.totals;
  const activeSeconds = sessions.reduce((acc, s) => acc + s.seconds, 0);

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>flockatime</h1>
          <div className="muted">
            {current?.captured_at
              ? `last snapshot ${clock(current.captured_at)}`
              : 'waiting for the first snapshot'}
            {lastSync && <span className="live" title="Auto-refreshing every 10s" />}
          </div>
        </div>

        {/* Filters in one row above the charts. */}
        <div className="controls">
          <select
            value={selected ?? ''}
            onChange={(e) => setSelected(e.target.value)}
            aria-label="Project"
          >
            {(projects ?? []).map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          {RANGES.map((d) => (
            <button
              key={d}
              className="chip"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
            >
              {d}d
            </button>
          ))}
        </div>
      </header>

      {error && <div className="card">Could not load data: {error}</div>}

      {projects !== null && projects.length === 0 && (
        <div className="card">
          <h2>No snapshots yet</h2>
          <p className="sub">
            Point the agent at this server and run <code>snapshot-agent run</code>. Projects appear
            here on the first successful POST.
          </p>
        </div>
      )}

      {selected && (
        <>
          {/* KPI row: headline numbers as stat tiles, not a one-bar chart. */}
          <div className="tiles">
            <Tile label="Lines" value={num(current?.total_lines)} sub={`${num(current?.file_count)} files`} />
            <Tile label="Active time" value={humanDuration(activeSeconds)} sub={`${sessions.length} sessions`} />
            <Tile
              label="Lines added"
              value={`+${num(totals?.lines_added)}`}
              sub={`−${num(totals?.lines_removed)} removed`}
            />
            <Tile
              label="Branch"
              value={current?.git_branch ?? '—'}
              sub={
                current?.git_dirty
                  ? `dirty · ${num(current?.git_ahead)} ahead`
                  : `clean · ${num(current?.git_ahead)} ahead`
              }
            />
          </div>

          <div className="card">
            <h2>Total lines</h2>
            <p className="sub">Every snapshot in the window, agent clock.</p>
            <TotalLines rows={timeline} />
          </div>

          <div className="card">
            <h2>Daily churn</h2>
            <p className="sub">Lines added above the line, removed below.</p>
            <Churn rows={summary?.daily ?? []} />
          </div>

          <div className="card">
            <h2>Sessions</h2>
            <p className="sub">
              Runs of snapshots whose tree actually moved, split on a gap longer than the session
              window.
            </p>
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Duration</th>
                    <th>Ticks</th>
                    <th>+ Lines</th>
                    <th>− Lines</th>
                    <th>Files touched</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">
                        No sessions in this window.
                      </td>
                    </tr>
                  )}
                  {sessions.map((s) => (
                    <tr key={s.started_at}>
                      <td>{clock(s.started_at)}</td>
                      <td>{humanDuration(s.seconds)}</td>
                      <td>{num(s.ticks)}</td>
                      <td>{num(s.lines_added)}</td>
                      <td>{num(s.lines_removed)}</td>
                      <td>{num(s.files_touched)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>Most-revised files</h2>
            <p className="sub">
              The agent never sends a path, so these are path hashes. Map one back locally with{' '}
              <code>snapshot-agent once</code>.
            </p>
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>Path hash</th>
                    <th>Revisions</th>
                  </tr>
                </thead>
                <tbody>
                  {hot.length === 0 && (
                    <tr>
                      <td colSpan={2} className="muted">
                        Nothing changed in this window.
                      </td>
                    </tr>
                  )}
                  {hot.map((f) => (
                    <tr key={f.path_hash}>
                      <td className="hash">{f.path_hash.slice(0, 16)}…</td>
                      <td>{num(f.revisions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="delta">{sub}</div>
    </div>
  );
}
