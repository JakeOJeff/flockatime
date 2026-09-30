import { useEffect, useMemo, useState } from 'react';
import {
  SignedOutError,
  clock,
  dayRange,
  getChurn,
  getCommits,
  getHackatime,
  getMe,
  getRhythm,
  getSessions,
  getSummary,
  getTimeline,
  humanDuration,
  listProjects,
  localDay,
  num,
  setSignedOutHandler,
  shortSha,
  type ChurnRow,
  type CommitRow,
  type Hackatime,
  type ProjectRow,
  type RhythmCell,
  type SessionRow,
  type SnapshotRow,
  type Summary,
} from './api';
import { TotalLines } from './charts/TotalLines';
import { Churn } from './charts/Churn';
import { DailyTime } from './charts/DailyTime';
import { Heatmap } from './charts/Heatmap';
import { RankBars } from './charts/RankBars';
import { LoggedOut } from './LoggedOut';

const RANGES = [1, 7, 30, 90];
const POLL_MS = 10_000;

type Auth = { state: 'loading' } | { state: 'out' } | { state: 'in'; who: string | null };

/**
 * The sign-in gate. Nothing but the logged-out screen renders without a
 * session, and any 401 later (expiry, allowlist change) drops back to it.
 */
export default function App() {
  const [auth, setAuth] = useState<Auth>({ state: 'loading' });
  const [reason] = useState(() => new URLSearchParams(location.search).get('auth_error'));

  useEffect(() => {
    // The reason code is read once; keep it out of the address bar after that.
    if (reason) history.replaceState(null, '', location.pathname);
    setSignedOutHandler(() => setAuth({ state: 'out' }));
    getMe()
      .then((r) =>
        setAuth(
          r.auth && !r.user ? { state: 'out' } : { state: 'in', who: r.user ? r.user.name ?? r.user.email : null },
        ),
      )
      .catch(() => setAuth({ state: 'out' }));
  }, [reason]);

  if (auth.state === 'loading') return null;
  if (auth.state === 'out') return <LoggedOut reason={reason} />;
  return <Dashboard who={auth.who} />;
}

function Dashboard({ who }: { who: string | null }) {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  const [timeline, setTimeline] = useState<SnapshotRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [commits, setCommits] = useState<CommitRow[]>([]);
  const [hot, setHot] = useState<ChurnRow[]>([]);
  const [rhythm, setRhythm] = useState<RhythmCell[]>([]);
  const [ht, setHt] = useState<Hackatime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);

  const report = (e: unknown) => {
    if (!(e instanceof SignedOutError)) setError(String(e));
  };

  useEffect(() => {
    listProjects()
      .then((r) => {
        setProjects(r.projects);
        setSelected((cur) => cur ?? r.projects[0]?.name ?? null);
      })
      .catch(report);
  }, []);

  // Hackatime is account-wide, not per project, and slow-moving: fetched when
  // the window changes, never polled. A failure only empties its own panel.
  useEffect(() => {
    let live = true;
    setHt(null);
    getHackatime(days)
      .then((r) => live && setHt(r))
      .catch(() => live && setHt({ configured: true, source: 'hack_club', error: 'unavailable' }));
    return () => {
      live = false;
    };
  }, [days]);

  // Full load, including churn — that endpoint unpacks stored file lists, so it
  // is only refetched when the project or the window actually changes.
  useEffect(() => {
    if (!selected) return;
    let live = true;
    setError(null);

    Promise.all([
      getTimeline(selected, days),
      getSummary(selected, days),
      getSessions(selected, days),
      getCommits(selected, days),
      getChurn(selected, days),
      getRhythm(selected, days),
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
      .catch((e) => live && report(e));

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
        const [t, s, ss, cm, p] = await Promise.all([
          getTimeline(selected, days),
          getSummary(selected, days),
          getSessions(selected, days),
          getCommits(selected, days),
          listProjects(),
        ]);
        if (!live) return;
        setTimeline(t.snapshots);
        setSummary(s);
        setSessions(ss.sessions);
        setCommits(cm.commits);
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
  const longest = sessions.reduce((acc, s) => Math.max(acc, s.seconds), 0);
  const htOk = ht && ht.configured && !ht.error ? ht : null;
  const htProject = htOk?.projects.find((p) => p.name.toLowerCase() === selected?.toLowerCase()) ?? null;
  const netLines = (totals?.lines_added ?? 0) - (totals?.lines_removed ?? 0);

  // Snapshots that came out of the offline queue were captured long before they
  // arrived. Every chart here is drawn on the agent clock, so say so rather than
  // letting a replayed backlog read as live activity.
  const delayedTicks = totals?.delayed_ticks ?? 0;
  const maxLag = totals?.max_lag_seconds ?? 0;

  const dayList = useMemo(() => dayRange(days), [days]);
  const timeSeries = useMemo(() => {
    const tree = new Map<string, number>();
    for (const s of sessions) {
      const d = localDay(s.started_at);
      tree.set(d, (tree.get(d) ?? 0) + s.seconds);
    }
    const out = [{ label: 'Tree moving (flockatime)', color: 'var(--series-1)', values: tree }];
    if (htOk) {
      out.push({
        label: 'Editor time (Hackatime)',
        color: 'var(--cat-2)',
        values: new Map(htOk.daily.map((d) => [d.day, d.seconds])),
      });
    }
    return out;
  }, [sessions, htOk]);

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
          {who && (
            <div className="muted">
              {who} · <a href="/auth/logout">Sign out</a>
            </div>
          )}
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

      {delayedTicks > 0 && (
        <div className="notice">
          <strong>{num(delayedTicks)}</strong> of these snapshots were replayed from the agent's
          offline queue, the latest arriving <strong>{humanDuration(maxLag)}</strong> after it was
          captured. Charts are plotted on the agent clock, so that work appears when it happened —
          not when it landed here.
        </div>
      )}

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
          {/* KPI rows: headline numbers as stat tiles, not one-bar charts. */}
          <div className="tiles">
            <Tile label="Lines" value={num(current?.total_lines)} sub={`${num(current?.file_count)} files`} />
            <Tile
              label="Active time"
              value={humanDuration(activeSeconds)}
              sub={`${sessions.length} sessions · longest ${humanDuration(longest)}`}
            />
            <Tile
              label="Net lines"
              value={`${netLines >= 0 ? '+' : '−'}${num(Math.abs(netLines))}`}
              sub={`+${num(totals?.lines_added)} / −${num(totals?.lines_removed)}`}
            />
            <Tile
              label="Branch"
              value={current?.git_branch ?? '—'}
              sub={`${shortSha(current?.git_head)} · ${
                current?.git_dirty ? 'dirty' : 'clean'
              } · ${num(current?.git_ahead)} ahead`}
            />
          </div>
          <div className="tiles">
            <Tile
              label="Files changed"
              value={num(
                (totals?.files_added ?? 0) + (totals?.files_removed ?? 0) + (totals?.files_modified ?? 0),
              )}
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
            <Tile
              label="Lines per active hour"
              value={activeSeconds > 0 ? num(Math.round(((totals?.lines_added ?? 0) * 3600) / activeSeconds)) : '—'}
              sub="lines added ÷ active time"
            />
          </div>

          <div className="card">
            <h2>Coding time per day</h2>
            <p className="sub">
              {htOk
                ? 'How long this project’s tree was moving, beside total editor time from Hackatime (all projects).'
                : 'How long this project’s tree was moving each day.'}
            </p>
            <DailyTime days={dayList} series={timeSeries} />
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
            <h2>Weekly rhythm</h2>
            <p className="sub">When the tree moves, by weekday and hour in your timezone.</p>
            <Heatmap cells={rhythm} />
          </div>

          <HackatimeCard ht={ht} project={selected} projectSeconds={htProject?.total_seconds ?? null} />

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
            <h2>Work per commit</h2>
            <p className="sub">
              Grouped by the commit that was HEAD at capture time — the span is how long you sat on
              it, the deltas are what you did on top of it.
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
              Ranked by net lines moved across revisions, not by save count. The agent never sends a
              path, so these are path hashes — map one back locally with{' '}
              <code>snapshot-agent once</code>.
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
      )}

      {projects && projects.length > 0 && (
        <div className="card">
          <h2>All projects</h2>
          <p className="sub">Latest snapshot of every project the agent has sent. Click one to open it.</p>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Lines</th>
                  <th>Files</th>
                  <th>Branch</th>
                  <th>State</th>
                  <th>Last snapshot</th>
                  <th>Agent</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr
                    key={p.name}
                    className={p.name === selected ? 'row-link current' : 'row-link'}
                    onClick={() => setSelected(p.name)}
                  >
                    <td>{p.name}</td>
                    <td>{num(p.total_lines)}</td>
                    <td>{num(p.file_count)}</td>
                    <td>{p.git_branch ?? '—'}</td>
                    <td>{p.git_head ? `${p.git_dirty ? 'dirty' : 'clean'} · ${num(p.git_ahead)} ahead` : '—'}</td>
                    <td>{p.captured_at ? clock(p.captured_at) : '—'}</td>
                    <td className="hash">{p.agent_version ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const HT_ERRORS: Record<string, string> = {
  not_found:
    'Hackatime has no account matching your Hack Club sign-in. Set HACKATIME_USER or the HACKATIME_API_KEY secret.',
  private: 'Your Hackatime stats are private. Set the HACKATIME_API_KEY secret to read them.',
  bad_key: 'Hackatime rejected the HACKATIME_API_KEY secret. Check it on hackatime.hackclub.com.',
  unavailable: 'Hackatime could not be reached. It will be retried when you change the window.',
};

function HackatimeCard({
  ht,
  project,
  projectSeconds,
}: {
  ht: Hackatime | null;
  project: string;
  projectSeconds: number | null;
}) {
  return (
    <div className="card">
      <h2>Hackatime</h2>
      <p className="sub">
        Editor time from{' '}
        <a href="https://hackatime.hackclub.com" target="_blank" rel="noreferrer">
          hackatime.hackclub.com
        </a>
        , across every project — not just this one.
        {ht && ht.configured && !ht.error && ht.username ? ` Hackatime user: ${ht.username}.` : ''}
      </p>

      {ht === null && <div className="empty">Loading Hackatime…</div>}
      {ht && !ht.configured && (
        <div className="empty">Sign in, or set HACKATIME_USER / HACKATIME_API_KEY, to show Hackatime stats.</div>
      )}
      {ht && ht.configured && ht.error && <div className="empty">{HT_ERRORS[ht.error]}</div>}

      {ht && ht.configured && !ht.error && (
        <>
          <div className="tiles inset">
            <Tile label="Coded" value={humanDuration(ht.total_seconds)} sub="in this window" />
            <Tile label="Daily average" value={humanDuration(ht.daily_average)} sub="per day, per Hackatime" />
            <Tile label="Streak" value={`${ht.streak} day${ht.streak === 1 ? '' : 's'}`} sub="consecutive days" />
            <Tile
              label={`On ${project}`}
              value={projectSeconds === null ? '—' : humanDuration(projectSeconds)}
              sub={projectSeconds === null ? 'no Hackatime project by this name' : 'Hackatime project time'}
            />
          </div>
          <div className="split">
            <div>
              <h3>Languages</h3>
              <RankBars
                rows={ht.languages.map((l) => ({ name: l.name, seconds: l.total_seconds, percent: l.percent }))}
              />
            </div>
            <div>
              <h3>Projects</h3>
              <RankBars
                rows={ht.projects.map((p) => ({
                  name: p.name,
                  seconds: p.total_seconds,
                  percent: p.percent,
                  current: p.name.toLowerCase() === project.toLowerCase(),
                }))}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const pct = (part: number | null | undefined, whole: number | null | undefined) =>
  whole ? `${Math.round(((part ?? 0) / whole) * 100)}%` : '—';

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="delta">{sub}</div>
    </div>
  );
}
