import { useEffect, useMemo, useState } from 'react';
import {
  SignedOutError,
  clock,
  dayRange,
  getChurn,
  getCommits,
  getRhythm,
  getSessions,
  getSummary,
  getTimeline,
  humanDuration,
  listProjects,
  localDay,
  num,
  shortSha,
  type ChurnRow,
  type CommitRow,
  type Hackatime,
  type ProjectRow,
  type RhythmCell,
  type SessionRow,
  type SnapshotRow,
  type Summary,
} from '../api';
import { href } from '../App';
import { TotalLines } from '../charts/TotalLines';
import { Churn } from '../charts/Churn';
import { DailyTime } from '../charts/DailyTime';
import { Heatmap } from '../charts/Heatmap';
import { InstallCard } from '../ConnectCli';
import { Filter, PageHead, RangeFilter, Tile, pct } from '../ui';
import { htOk } from './Home';

const POLL_MS = 10_000;

interface Props {
  project: string | null;
  days: number;
  setDays: (d: number) => void;
  ht: Hackatime | null;
}

export function Projects(props: Props) {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The list is cheap (latest row per project), so it polls alongside the agent.
  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.hidden) return;
      listProjects()
        .then((r) => live && setProjects(r.projects))
        .catch((e) => live && !(e instanceof SignedOutError) && setError(String(e)));
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  if (error) return <div className="card">Could not load projects: {error}</div>;
  if (projects === null) return null;

  return props.project ? (
    <ProjectDetail {...props} name={props.project} projects={projects} />
  ) : (
    <ProjectList projects={projects} ht={props.ht} days={props.days} setDays={props.setDays} />
  );
}

function ProjectList({
  projects,
  ht,
  days,
  setDays,
}: {
  projects: ProjectRow[];
  ht: Hackatime | null;
  days: number;
  setDays: (d: number) => void;
}) {
  const ok = htOk(ht);
  const htTime = (name: string) =>
    ok?.projects.find((p) => p.name.toLowerCase() === name.toLowerCase())?.total_seconds ?? null;

  return (
    <>
      <PageHead eyebrow="flockatime" title="Projects">
        <p className="lede">Every git repo the agent has snapshotted. Open one for its lines, churn and sessions.</p>
      </PageHead>

      {projects.length === 0 ? (
        <InstallCard intro />
      ) : (
        <>
          <div className="filters">
            <RangeFilter days={days} onChange={setDays} />
          </div>
          <div className="pgrid">
            {projects.map((p) => {
              const t = htTime(p.name);
              return (
                <a key={p.name} className="pcard" href={href('projects', p.name)}>
                  <div className="pcard-name">{p.name}</div>
                  <div className="pcard-time">{t === null ? '—' : humanDuration(t)}</div>
                  <div className="pcard-meta">
                    <span>{num(p.total_lines)} lines</span>
                    <span>{num(p.file_count)} files</span>
                    <span>{p.git_branch ?? 'no branch'}</span>
                  </div>
                  <div className="pcard-foot">
                    {p.captured_at ? `Last snapshot ${clock(p.captured_at)}` : 'Waiting for the first snapshot'}
                  </div>
                </a>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function ProjectDetail({
  name,
  projects,
  days,
  setDays,
  ht,
}: Props & { name: string; projects: ProjectRow[] }) {
  const [timeline, setTimeline] = useState<SnapshotRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [commits, setCommits] = useState<CommitRow[]>([]);
  const [hot, setHot] = useState<ChurnRow[]>([]);
  const [rhythm, setRhythm] = useState<RhythmCell[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);

  // Full load, including churn — that endpoint unpacks stored file lists, so it
  // is only refetched when the project or the window actually changes.
  useEffect(() => {
    let live = true;
    setError(null);

    Promise.all([
      getTimeline(name, days),
      getSummary(name, days),
      getSessions(name, days),
      getCommits(name, days),
      getChurn(name, days),
      getRhythm(name, days),
    ])
      .then(([t, s, ss, cm, c, rh]) => {
        if (!live) return;
        setTimeline(t.snapshots);
        setSummary(s);
        setSessions(ss.sessions);
        setCommits(cm.commits);
        setHot(c.files);
        setRhythm(rh.cells);
      })
      .catch((e) => live && !(e instanceof SignedOutError) && setError(String(e)));

    return () => {
      live = false;
    };
  }, [name, days]);

  // The agent ticks on its own schedule, so poll the pure-D1 endpoints and let
  // the page keep up with it. Paused while the tab is hidden.
  useEffect(() => {
    let live = true;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const [t, s, ss, cm] = await Promise.all([
          getTimeline(name, days),
          getSummary(name, days),
          getSessions(name, days),
          getCommits(name, days),
        ]);
        if (!live) return;
        setTimeline(t.snapshots);
        setSummary(s);
        setSessions(ss.sessions);
        setCommits(cm.commits);
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
  }, [name, days]);

  const current = projects.find((p) => p.name === name) ?? null;
  const totals = summary?.totals;
  const activeSeconds = sessions.reduce((acc, s) => acc + s.seconds, 0);
  const longest = sessions.reduce((acc, s) => Math.max(acc, s.seconds), 0);
  const ok = htOk(ht);
  const htProject = ok?.projects.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null;
  const netLines = (totals?.lines_added ?? 0) - (totals?.lines_removed ?? 0);

  // Snapshots that came out of the offline queue were captured long before they
  // arrived. Every chart here is drawn on the agent clock, so say so rather than
  // letting a replayed backlog read as live activity.
  const delayedTicks = totals?.delayed_ticks ?? 0;
  const maxLag = totals?.max_lag_seconds ?? 0;

  const dayList = useMemo(() => dayRange(Math.min(days, 90)), [days]);
  const timeSeries = useMemo(() => {
    const tree = new Map<string, number>();
    for (const s of sessions) {
      const d = localDay(s.started_at);
      tree.set(d, (tree.get(d) ?? 0) + s.seconds);
    }
    const out = [{ label: 'Tree moving (flockatime)', color: 'var(--series-1)', values: tree }];
    if (ok) {
      out.push({
        label: 'Editor time (Hackatime, all projects)',
        color: 'var(--cat-2)',
        values: new Map(ok.daily.map((d) => [d.day, d.seconds])),
      });
    }
    return out;
  }, [sessions, ok]);

  return (
    <>
      <a className="back" href={href('projects')}>
        ← All projects
      </a>
      <PageHead title={name}>
        <p className="lede">
          {current?.captured_at ? `Last snapshot ${clock(current.captured_at)}` : 'Waiting for the first snapshot'}
          {lastSync && <span className="live" title="Auto-refreshing every 10s" />}
        </p>
      </PageHead>

      <div className="filters">
        <RangeFilter days={days} onChange={setDays} />
        <Filter label="Project">
          <select value={name} onChange={(e) => (location.hash = href('projects', e.target.value))}>
            {!current && <option value={name}>{name}</option>}
            {projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </Filter>
      </div>

      {error && <div className="card">Could not load data: {error}</div>}

      {delayedTicks > 0 && (
        <div className="notice">
          <strong>{num(delayedTicks)}</strong> of these snapshots were replayed from the agent's offline queue,
          the latest arriving <strong>{humanDuration(maxLag)}</strong> after it was captured. Charts are plotted
          on the agent clock, so that work appears when it happened — not when it landed here.
        </div>
      )}

      <div className="tiles">
        <Tile label="Lines" value={num(current?.total_lines)} sub={`${num(current?.file_count)} files`} accent />
        <Tile
          label="Active time"
          value={humanDuration(activeSeconds)}
          sub={`${sessions.length} sessions · longest ${humanDuration(longest)}`}
        />
        <Tile
          label="Hackatime"
          value={htProject ? humanDuration(htProject.total_seconds) : '—'}
          sub={htProject ? 'editor time on this project' : 'no Hackatime project by this name'}
        />
        <Tile
          label="Net lines"
          value={`${netLines >= 0 ? '+' : '−'}${num(Math.abs(netLines))}`}
          sub={`+${num(totals?.lines_added)} / −${num(totals?.lines_removed)}`}
        />
        <Tile
          label="Branch"
          value={current?.git_branch ?? '—'}
          sub={`${shortSha(current?.git_head)} · ${current?.git_dirty ? 'dirty' : 'clean'} · ${num(
            current?.git_ahead,
          )} ahead`}
        />
        <Tile
          label="Files changed"
          value={num((totals?.files_added ?? 0) + (totals?.files_removed ?? 0) + (totals?.files_modified ?? 0))}
          sub={`+${num(totals?.files_added)} new · −${num(totals?.files_removed)} gone · ${num(
            totals?.files_modified,
          )} edited`}
        />
        <Tile
          label="Snapshots"
          value={num(totals?.ticks)}
          sub={`${num(totals?.active_ticks)} with changes (${pct(totals?.active_ticks, totals?.ticks)})`}
        />
        <Tile
          label="Commits worked on"
          value={num(totals?.commits)}
          sub={`across ${num(totals?.branches)} branch${totals?.branches === 1 ? '' : 'es'}`}
        />
      </div>

      <div className="card">
        <h2>Coding time per day</h2>
        <p className="sub">
          {ok
            ? 'How long this project’s tree was moving, beside total editor time from Hackatime.'
            : 'How long this project’s tree was moving each day.'}
        </p>
        <DailyTime days={dayList} series={timeSeries} />
      </div>

      <div className="grid-2">
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
      </div>

      <div className="card">
        <h2>Weekly rhythm</h2>
        <p className="sub">When the tree moves, by weekday and hour in your timezone.</p>
        <Heatmap cells={rhythm} />
      </div>

      <div className="card">
        <h2>Sessions</h2>
        <p className="sub">
          Runs of snapshots whose tree actually moved, split on a gap longer than the session window.
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
        <h2>Work per commit</h2>
        <p className="sub">
          Grouped by the commit that was HEAD at capture time — the span is how long you sat on it, the deltas
          are what you did on top of it.
        </p>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>HEAD</th>
                <th>Branch</th>
                <th>Started</th>
                <th>Span</th>
                <th>+ Lines</th>
                <th>− Lines</th>
                <th>Files touched</th>
              </tr>
            </thead>
            <tbody>
              {commits.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No git state in this window.
                  </td>
                </tr>
              )}
              {commits.map((cm) => (
                <tr key={cm.git_head}>
                  <td className="hash">
                    {shortSha(cm.git_head)}
                    {cm.ever_dirty ? <span className="dot" title="Tree was dirty" /> : null}
                  </td>
                  <td>{cm.git_branch ?? '—'}</td>
                  <td>{clock(cm.first_seen)}</td>
                  <td>{humanDuration(cm.seconds)}</td>
                  <td>{num(cm.lines_added)}</td>
                  <td>{num(cm.lines_removed)}</td>
                  <td>{num(cm.files_touched)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Most-revised files</h2>
        <p className="sub">
          Ranked by net lines moved across revisions, not by save count. The agent never sends a path, so these
          are path hashes — map one back locally with <code>snapshot-agent once</code>.
        </p>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Path hash</th>
                <th>Lines moved</th>
                <th>Revisions</th>
                <th>Lines now</th>
              </tr>
            </thead>
            <tbody>
              {hot.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    Nothing changed in this window.
                  </td>
                </tr>
              )}
              {hot.map((f) => (
                <tr key={f.path_hash}>
                  <td className="hash">{f.path_hash.slice(0, 16)}…</td>
                  <td>{num(f.lines_moved)}</td>
                  <td>{num(f.revisions)}</td>
                  <td>{num(f.lines)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
