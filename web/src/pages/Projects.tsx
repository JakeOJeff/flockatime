import { useEffect, useMemo, useState } from 'react';
import {
  SignedOutError,
  ago,
  bytes,
  clock,
  dayLabel,
  dayRange,
  getChurn,
  getCommits,
  getHackatimeProject,
  getOverlap,
  getRhythm,
  getSaves,
  getSessions,
  getSummary,
  getTimeline,
  humanDuration,
  listProjects,
  localDay,
  newestVersion,
  num,
  shortSha,
  signed,
  type ChainBreak,
  type Churn as ChurnData,
  type CommitRow,
  type Hackatime,
  type Overlap,
  type ProjectRow,
  type RhythmCell,
  type SavesByHour,
  type SessionRow,
  type SnapshotRow,
  type Summary,
} from '../api';
import { href } from '../App';
import { TotalLines } from '../charts/TotalLines';
import { Churn } from '../charts/Churn';
import { DailyTime } from '../charts/DailyTime';
import { Heatmap } from '../charts/Heatmap';
import { HourBars, SplitBar } from '../charts/HourBars';
import { ALL_TIME, PageHead, Pills, RangePills, SourceTag, pct, type Source } from '../ui';
import { HT_ERRORS, htOk } from './Home';

const POLL_MS = 10_000;
/** The daily chart reaches back at most this far, like Hackatime's spans. */
const CHART_DAYS = 90;

interface Props {
  project: string | null;
  days: number;
  setDays: (d: number) => void;
  ht: Hackatime | null;
  source: Source;
  setSource: (s: Source) => void;
}

export function Projects(props: Props) {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The list is cheap (latest row per project), so it polls alongside the agent.
  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.hidden) return;
      listProjects(props.days)
        .then((r) => live && setProjects(r.projects))
        .catch((e) => live && !(e instanceof SignedOutError) && setError(String(e)));
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [props.days]);

  if (error) return <div className="card">Could not load projects: {error}</div>;
  if (projects === null) return null;

  return props.project ? (
    <ProjectDetail {...props} name={props.project} projects={projects} />
  ) : (
    <ProjectList {...props} projects={projects} />
  );
}

type SortKey = 'cli' | 'ht' | 'lines' | 'last';

/** Last snapshot: a date, with the time when it is recent enough to matter. */
const lastSnap = (unix: number | null) => {
  if (!unix) return 'never';
  const d = new Date(unix * 1000);
  const recent = Date.now() / 1000 - unix < 7 * 86400;
  return recent
    ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** Agents from 0.3 update themselves; older ones need a manual update. */
const canSelfUpdate = (v: string) => {
  const [a, b] = v.split('.').map(Number);
  return a > 0 || b >= 3;
};

function ProjectList({ projects, ht, days, setDays }: Props & { projects: ProjectRow[] }) {
  const [query, setQuery] = useState('');
  const [onlyDirty, setOnlyDirty] = useState(false);
  const [onlyOutdated, setOnlyOutdated] = useState(false);
  const ok = htOk(ht);
  // Until a column is picked, sort by Hackatime once it has loaded.
  const [picked, setSort] = useState<SortKey | null>(null);
  const sort: SortKey = picked ?? (ok ? 'ht' : 'cli');

  const htTime = useMemo(() => {
    const m = new Map((ok?.projects ?? []).map((p) => [p.name.toLowerCase(), p.total_seconds]));
    return (name: string) => m.get(name.toLowerCase()) ?? null;
  }, [ok]);
  const newest = newestVersion(projects.map((p) => p.agent_version));
  const outdated = (p: ProjectRow) =>
    !!(newest && p.agent_version && p.agent_version !== newest && /^\d/.test(p.agent_version));
  const dirtyCount = projects.filter((p) => p.git_dirty).length;
  const outdatedRows = projects.filter(outdated);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const key: Record<SortKey, (p: ProjectRow) => number> = {
      cli: (p) => p.active_seconds,
      ht: (p) => htTime(p.name) ?? -1,
      lines: (p) => (p.window.lines_added ?? 0) + (p.window.lines_removed ?? 0),
      last: (p) => p.captured_at ?? 0,
    };
    return projects
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.git_branch ?? '').toLowerCase().includes(q))
      .filter((p) => !onlyDirty || p.git_dirty)
      .filter((p) => !onlyOutdated || outdated(p))
      .sort((a, b) => key[sort](b) - key[sort](a) || b.active_seconds - a.active_seconds);
  }, [projects, query, onlyDirty, onlyOutdated, sort, htTime, newest]);

  const cliTotal = projects.reduce((a, p) => a + p.active_seconds, 0);
  const htTotal = projects.reduce((a, p) => a + (htTime(p.name) ?? 0), 0);
  const oldVersions = [...new Set(outdatedRows.map((p) => p.agent_version as string))];

  const head = (
    <PageHead title="Projects" aside={<RangePills days={days} onChange={setDays} />}>
      <p className="lede">Every git repo snapshot-agent has seen. Click one for lines, churn and sessions.</p>
    </PageHead>
  );

  if (projects.length === 0) {
    return (
      <>
        {head}
        <div className="card">
          <h2>No repos yet</h2>
          <p className="sub">
            Nothing has arrived from snapshot-agent. <a href={href('extensions')}>Set it up</a> on the machine you
            code on and your repos appear here as you edit them.
          </p>
        </div>
        <HackatimeProjects ht={ht} projects={projects} />
      </>
    );
  }

  const SortTh = ({ k, label, className }: { k: SortKey; label: string; className?: string }) => (
    <th className={className} aria-sort={sort === k ? 'descending' : undefined}>
      <button onClick={() => setSort(k)}>
        {label}
        {sort === k ? ' ↓' : ''}
      </button>
    </th>
  );

  return (
    <>
      {head}

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search repos…"
          aria-label="Search repos"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {dirtyCount > 0 && (
          <button className="chip" aria-pressed={onlyDirty} onClick={() => setOnlyDirty(!onlyDirty)}>
            Dirty<b>{dirtyCount}</b>
          </button>
        )}
        {outdatedRows.length > 0 && (
          <button className="chip warn" aria-pressed={onlyOutdated} onClick={() => setOnlyOutdated(!onlyOutdated)}>
            Outdated agent<b>{outdatedRows.length}</b>
          </button>
        )}
        <span className="total">
          <b className="cli">{humanDuration(cliTotal)}</b> captured
          {ok && (
            <>
              {' '}
              of <b className="ht">{humanDuration(htTotal)}</b>
            </>
          )}
        </span>
      </div>

      <div className="card flush">
        <div className="scroll-x">
          <table className="ptable">
            <thead>
              <tr>
                <th>Repo</th>
                <SortTh k="cli" label="Snapshot" className="cli" />
                {ok && <SortTh k="ht" label="Hackatime" className="ht" />}
                {ok && <th className="left">Captured</th>}
                <SortTh k="lines" label="Lines changed" />
                <th className="left">Status</th>
                <SortTh k="last" label="Last snapshot" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No repos match.
                  </td>
                </tr>
              )}
              {rows.map((p) => {
                const t = htTime(p.name);
                const share = t ? Math.min(1, p.active_seconds / t) : null;
                return (
                  <tr key={p.name} onClick={() => (location.hash = href('projects', p.name))}>
                    <td>
                      <div className="repo">
                        <a href={href('projects', p.name)} onClick={(e) => e.stopPropagation()}>
                          {p.name}
                        </a>
                      </div>
                      <div className="repo-sub">
                        {[p.git_branch, p.total_lines !== null && `${num(p.total_lines)} lines`, p.file_count !== null && `${num(p.file_count)} files`]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td className="cli">{humanDuration(p.active_seconds)}</td>
                    {ok && <td className={t === null ? 'muted' : 'ht'}>{t === null ? '—' : humanDuration(t)}</td>}
                    {ok && (
                      <td className="left">
                        {share === null ? (
                          <span className="muted small">not in Hackatime</span>
                        ) : (
                          <div className="cap" title="Share of Hackatime's time snapshot-agent saw files changing">
                            <div className="cap-track">
                              <span style={{ width: `${share * 100}%` }} />
                            </div>
                            <span className="cap-pct">{Math.round(share * 100)}%</span>
                          </div>
                        )}
                      </td>
                    )}
                    <td>
                      <span className="add">+{num(p.window.lines_added)}</span>
                      <span className="rem">−{num(p.window.lines_removed)}</span>
                    </td>
                    <td className="left">
                      <Status p={p} outdated={outdated(p)} />
                    </td>
                    <td className="when">{lastSnap(p.captured_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {outdatedRows.length > 0 && (
          <div className="card-foot warn">
            <span>
              {outdatedRows.length} repo{outdatedRows.length === 1 ? '' : 's'} last reported from agent{' '}
              {oldVersions.join(', ')}
              {oldVersions.every((v) => !canSelfUpdate(v)) ? ', which can’t update itself' : ', which hasn’t updated itself'}
              . Run <span className="kbd-cmd">snapshot-agent update</span> on that machine.
            </span>
            <a href={href('settings')}>Show machine →</a>
          </div>
        )}
      </div>

      <HackatimeProjects ht={ht} projects={projects} />
    </>
  );
}

/** What needs attention on a repo, from its latest snapshot and this window. */
function Status({ p, outdated }: { p: ProjectRow; outdated: boolean }) {
  const flags: [string, string, string][] = [];
  if ((p.git_conflicted ?? 0) > 0) flags.push(['bad', 'conflict', 'Files in merge conflict']);
  if (p.git_dirty) {
    const n = (p.git_insertions ?? 0) + (p.git_deletions ?? 0);
    flags.push(['muted-pill', 'dirty', n ? `${num(n)} uncommitted lines` : 'Uncommitted changes']);
  }
  if ((p.git_behind ?? 0) > 0) flags.push(['muted-pill', `${p.git_behind} behind`, 'Commits behind upstream']);
  if (p.window.chain_breaks > 0)
    flags.push(['warn', `${p.window.chain_breaks} break${p.window.chain_breaks === 1 ? '' : 's'}`, 'Snapshots missing, forked or restarted']);
  if (outdated && p.agent_version) flags.push(['warn', p.agent_version, 'Older than the newest agent reporting here']);
  if (flags.length === 0) return <span className="pill ok">all good</span>;
  return (
    <>
      {flags.map(([cls, text, title]) => (
        <span key={text} className={`pill ${cls}`} title={title}>
          {text}
        </span>
      ))}
    </>
  );
}

const DETAIL_RANGES = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: ALL_TIME, label: 'All time' },
];

/** Sessions shown before "Show all". */
const SESSION_ROWS = 6;

/** The HEAD a session sat on: the commit whose span overlaps it the most. */
function headFor(s: SessionRow, commits: CommitRow[]): CommitRow | null {
  let best: CommitRow | null = null;
  let most = -1;
  for (const cm of commits) {
    const overlap = Math.min(s.ended_at, cm.last_seen) - Math.max(s.started_at, cm.first_seen);
    if (overlap >= 0 && overlap > most) {
      best = cm;
      most = overlap;
    }
  }
  return best;
}

const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

function ProjectDetail({ name, projects, days, setDays, ht }: Props & { name: string; projects: ProjectRow[] }) {
  const [timeline, setTimeline] = useState<SnapshotRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [gap, setGap] = useState<number | null>(null);
  const [commits, setCommits] = useState<CommitRow[]>([]);
  const [churn, setChurn] = useState<ChurnData | null>(null);
  const [rhythm, setRhythm] = useState<RhythmCell[]>([]);
  const [saves, setSaves] = useState<SavesByHour | null>(null);
  const [overlap, setOverlap] = useState<Overlap | null>(null);
  const [htDaily, setHtDaily] = useState<Map<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [allSessions, setAllSessions] = useState(false);

  // Full load, including churn and overlap — those read file lists or every
  // fingerprint, so they are only refetched when the project or window changes.
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
      getSaves(name, days),
      getOverlap(name),
    ])
      .then(([t, s, ss, cm, c, rh, sv, ov]) => {
        if (!live) return;
        setTimeline(t.snapshots);
        setSummary(s);
        setSessions(ss.sessions);
        setGap(ss.gap_seconds);
        setCommits(cm.commits);
        setChurn(c);
        setRhythm(rh.cells);
        setSaves(sv);
        setOverlap(ov);
      })
      .catch((e) => live && !(e instanceof SignedOutError) && setError(String(e)));

    // Hackatime is a separate service, so it never holds up the rest of the page.
    setHtDaily(null);
    getHackatimeProject(name, Math.min(days, CHART_DAYS))
      .then((r) => live && setHtDaily(r.configured && !r.error ? new Map(r.daily.map((d) => [d.day, d.seconds])) : null))
      .catch(() => undefined);

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
  const ok = htOk(ht);
  const htProject = ok?.projects.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null;
  const netLines = (totals?.lines_added ?? 0) - (totals?.lines_removed ?? 0);
  // True diffs exist only from agent 0.3; before that every count is a net estimate.
  const exact = totals?.exact_added !== null && totals?.exact_added !== undefined;
  const hasSaves = totals?.saves !== null && totals?.saves !== undefined;
  const hasTree = current?.git_staged !== null && current?.git_staged !== undefined;
  const version = current?.agent_version ?? null;
  const oldAgent = !!version && /^\d/.test(version) && !canSelfUpdate(version);

  // Snapshots that came out of the offline queue were captured long before they
  // arrived. Every chart here is drawn on the agent clock, so say so rather than
  // letting a replayed backlog read as live activity.
  const delayedTicks = totals?.delayed_ticks ?? 0;
  const maxLag = totals?.max_lag_seconds ?? 0;

  const dayList = useMemo(() => dayRange(Math.min(days, CHART_DAYS)), [days]);
  const tree = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) {
      const d = localDay(s.started_at);
      m.set(d, (m.get(d) ?? 0) + s.seconds);
    }
    return m;
  }, [sessions]);
  const series = useMemo(
    () => [
      ...(htDaily ? [{ label: 'Hackatime editor time', color: 'var(--ht)', values: htDaily }] : []),
      { label: 'Snapshot: tree moving', color: 'var(--cli)', values: tree },
    ],
    [htDaily, tree],
  );
  const perDay = dayList.map((d) => ({ d, s: Math.max(0, ...series.map((x) => x.values.get(d) ?? 0)) }));
  const busiest = perDay.reduce((a, b) => (b.s > a.s ? b : a), { d: '', s: 0 });
  const activeDays = perDay.filter((x) => x.s > 0).length;
  const treeDays = dayList.filter((d) => (tree.get(d) ?? 0) > 0);
  const mark = htDaily && treeDays.length === 1 ? { day: treeDays[0], label: 'only snapshot' } : undefined;

  const heads = new Set(sessions.map((s) => headFor(s, commits)?.git_head).filter(Boolean)).size;
  const share = htProject && htProject.total_seconds > 0 ? activeSeconds / htProject.total_seconds : null;

  // What only agent 0.3 sends. On an older agent, the ones with nothing to show
  // collapse into one card instead of six empty ones.
  const has = {
    saves: (saves?.total ?? 0) > 0,
    edits: (totals?.tail_edits ?? 0) + (totals?.mid_edits ?? 0) > 0,
    files: (churn?.files.length ?? 0) > 0,
    shared: (overlap?.files_fingerprinted ?? 0) > 0,
    chain: (totals?.chained ?? 0) > 0,
    activity: hasSaves || (totals?.builds ?? 0) > 0 || (totals?.tests ?? 0) > 0,
  };
  const show = (k: keyof typeof has) => !oldAgent || has[k];
  const locked = UNLOCKS.filter((u) => !show(u.key));

  return (
    <>
      <a className="back" href={href('projects')}>
        ← All projects
      </a>
      <PageHead
        title={
          <>
            {name}
            {current?.git_branch || current?.git_head ? (
              <span className="head-ref">
                {[current.git_branch, current.git_head && shortSha(current.git_head)].filter(Boolean).join(' · ')}
              </span>
            ) : null}
            {current?.git_dirty ? (
              <span className="head-dirty" title="Uncommitted changes at the last snapshot">
                dirty
              </span>
            ) : null}
          </>
        }
        aside={<Pills label="Date range" value={days} options={DETAIL_RANGES} onChange={setDays} />}
      >
        <p className="lede">
          {current?.captured_at
            ? `Last snapshot ${clock(current.captured_at)}, ${ago(current.captured_at)}`
            : 'Waiting for the first snapshot'}
          {current?.total_lines !== null && current?.total_lines !== undefined && (
            <> · {num(current.total_lines)} lines in {plural(current.file_count ?? 0, 'file')}</>
          )}
          {lastSync && <span className="live" title="Auto-refreshing every 10s" />}
        </p>
      </PageHead>

      {oldAgent && (
        <div className="banner">
          <span>
            <strong>This repo was captured by agent {version}, so most charts are empty.</strong> Update to 0.3 to
            fill in saves, per-line edits, fingerprints and the history chain.
          </span>
          <CopyCommand cmd="snapshot-agent update" />
        </div>
      )}

      {error && <div className="card">Could not load data: {error}</div>}

      {delayedTicks > 0 && (
        <div className="notice">
          <strong>{num(delayedTicks)}</strong> of these snapshots were replayed from the agent's offline queue,
          the latest arriving <strong>{humanDuration(maxLag)}</strong> after it was captured. Charts are plotted
          on the agent clock, so that work appears when it happened — not when it landed here.
        </div>
      )}

      <div className="statrow">
        {ok && (
          <div className="ht">
            <div className="label">Hackatime</div>
            <div className="value">{htProject ? humanDuration(htProject.total_seconds) : '—'}</div>
            <div className="sub">{htProject ? 'editor time on this repo' : 'no Hackatime project by this name'}</div>
          </div>
        )}
        <div className="cli">
          <div className="label">Captured</div>
          <div className="value">{humanDuration(activeSeconds)}</div>
          <div className="sub">
            {plural(sessions.length, 'session')}
            {share !== null && (share < 0.05 ? ' · tree barely moved' : ` · ${Math.round(share * 100)}% of Hackatime`)}
          </div>
        </div>
        <div>
          <div className="label">Lines</div>
          <div className="value">{num(current?.total_lines)}</div>
          <div className="sub">
            {plural(current?.file_count ?? 0, 'file')}
            {current?.total_bytes ? ` · ${bytes(current.total_bytes)}` : ''}
          </div>
        </div>
        <div>
          <div className="label">Lines written</div>
          <div className="value">{signed(netLines)}</div>
          <div className="sub">
            +{num(totals?.lines_added)} / −{num(totals?.lines_removed)}
            {exact ? '' : ' net'}
          </div>
        </div>
        <div>
          <div className="label">Snapshots</div>
          <div className="value">{num(totals?.ticks)}</div>
          <div className="sub">{num(totals?.active_ticks)} with changes</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Coding time per day</h2>
          {htDaily && <span className="src-tag hackatime">Hackatime editor time</span>}
          <span className="src-tag cli">Snapshot: tree moving</span>
          {busiest.s > 0 && (
            <span className="meta">
              Busiest day {dayLabel(busiest.d)}, {humanDuration(busiest.s)} · {plural(activeDays, 'active day')}
            </span>
          )}
        </div>
        <DailyTime days={dayList} series={series} mark={mark} legend={false} />
      </div>

      <div className="grid-2 wide-left">
        <div className="card">
          <div className="card-head">
            <h2>Sessions and commits</h2>
            <span className="meta-inline muted small">
              {sessions.length === 1 ? 'One session' : plural(sessions.length, 'session')},{' '}
              {heads === 1 ? 'one HEAD' : plural(heads, 'HEAD')}
            </span>
          </div>
          <div className="scroll-x">
            <table className="stable">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Ticks</th>
                  <th>Lines ±</th>
                  <th>Files</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No sessions in this window.
                    </td>
                  </tr>
                )}
                {(allSessions ? sessions : sessions.slice(0, SESSION_ROWS)).map((s) => {
                  const cm = headFor(s, commits);
                  return (
                    <tr key={s.started_at}>
                      <td>
                        <div className="s-when">{clock(s.started_at)}</div>
                        {cm && (
                          <div className="s-head">
                            on <code>{shortSha(cm.git_head)}</code>
                            {cm.ever_dirty ? <span className="dot" title="Tree was dirty" /> : null}{' '}
                            {[cm.git_branch, cm.ever_dirty && 'uncommitted', `sat on it ${humanDuration(cm.seconds)}`]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        )}
                      </td>
                      <td>{humanDuration(s.seconds)}</td>
                      <td>{num(s.ticks)}</td>
                      <td className="muted">
                        +{num(s.lines_added)} / −{num(s.lines_removed)}
                      </td>
                      <td>{num(s.files_touched)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {sessions.length > SESSION_ROWS && (
            <button className="link-btn" onClick={() => setAllSessions(!allSessions)}>
              {allSessions ? 'Show fewer' : `Show all ${num(sessions.length)}`}
            </button>
          )}
          <p className="foot-note">
            A session is a run of snapshots where the tree moved, split on any gap longer than{' '}
            {humanDuration(gap ?? 900)}.
          </p>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Weekly rhythm</h2>
            <span className="meta-inline muted small">When the tree moved</span>
          </div>
          <Heatmap cells={rhythm} compact />
        </div>
      </div>

      {timeline.length > 2 && (
        <div className="grid-2">
          <div className="card">
            <div className="card-head">
              <h2>Total lines</h2>
              <span className="meta-inline muted small">Every snapshot, agent clock</span>
            </div>
            <TotalLines rows={timeline} />
          </div>
          <div className="card">
            <div className="card-head">
              <h2>Daily churn</h2>
              <span className="meta-inline muted small">
                {exact ? 'Added above the line, removed below' : 'Net change per snapshot'}
              </span>
            </div>
            <Churn rows={summary?.daily ?? []} />
          </div>
        </div>
      )}

      {hasTree && current && <WorkingTree p={current} />}

      {(show('saves') || show('edits')) && (
        <div className="grid-2">
          {show('saves') && (
            <div className="card">
              <div className="card-head">
                <h2>Saves by hour</h2>
                <span className="meta-inline muted small">From the daemon, in your timezone</span>
              </div>
              {has.saves && saves ? (
                <HourBars hours={saves.hours} unit="saves" />
              ) : (
                <div className="empty">No saves in this window.</div>
              )}
            </div>
          )}
          {show('edits') && (
            <div className="card">
              <div className="card-head">
                <h2>Where edits land</h2>
                <span className="meta-inline muted small">Appending new code vs. editing the middle</span>
              </div>
              {has.edits ? (
                <SplitBar
                  parts={[
                    { label: 'at the end of the file', value: totals?.tail_edits ?? 0, color: 'var(--cat-1)' },
                    { label: 'inside the file', value: totals?.mid_edits ?? 0, color: 'var(--cat-3)' },
                  ]}
                />
              ) : (
                <div className="empty">No per-line edits in this window.</div>
              )}
            </div>
          )}
        </div>
      )}

      {show('activity') && <Activity totals={totals ?? null} current={current} activeSeconds={activeSeconds} />}

      {show('files') && <HotFiles churn={churn} project={name} />}

      {show('shared') && <CopyDetection overlap={overlap} project={name} />}

      {locked.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Unlocks with agent 0.3</h2>
            <span className="meta-inline muted small">These fill in on their own once this machine updates</span>
          </div>
          <ul className="unlocks">
            {locked.map((u) => (
              <li key={u.key}>
                <b>{u.title}</b>
                <span>{u.sub}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Integrity totals={totals ?? null} breaks={summary?.breaks ?? []} current={current} />
    </>
  );
}

const UNLOCKS: { key: 'saves' | 'edits' | 'files' | 'shared' | 'chain' | 'activity'; title: string; sub: string }[] = [
  { key: 'saves', title: 'Saves by hour', sub: 'when files get saved, from the daemon' },
  { key: 'edits', title: 'Where edits land', sub: 'appending new code vs. editing the middle' },
  { key: 'files', title: 'Most-revised files', sub: 'which files you keep coming back to' },
  { key: 'shared', title: 'Shared code', sub: 'copies of code across your projects' },
  { key: 'chain', title: 'History chain', sub: 'proof no snapshot was dropped or forged' },
  { key: 'activity', title: 'Saves, builds, tests', sub: 'counted from the file tree' },
];

/** A shell command and a button that copies it. */
function CopyCommand({ cmd }: { cmd: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="copy-cmd">
      <span className="kbd-cmd">{cmd}</span>
      <button
        className="btn-lime sm"
        onClick={() =>
          navigator.clipboard
            ?.writeText(cmd)
            .then(() => {
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            })
            .catch(() => undefined)
        }
      >
        {done ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}

/** Saves, builds, tests and commits in the window. */
function Activity({
  totals,
  current,
  activeSeconds,
}: {
  totals: Summary['totals'];
  current: ProjectRow | null;
  activeSeconds: number;
}) {
  const saves = totals?.saves;
  const items: [string, string][] = [
    ['Saves', saves !== null && saves !== undefined ? num(saves) : '—'],
    [
      'Per active hour',
      saves !== null && saves !== undefined && activeSeconds > 0 ? num(Math.round((saves / activeSeconds) * 3600)) : '—',
    ],
    ['Builds', num(totals?.builds)],
    ['Tests', num(totals?.tests)],
    ['Commits made', totals?.commits_made !== null && totals?.commits_made !== undefined ? num(totals.commits_made) : '—'],
    [
      'Files changed',
      num((totals?.files_added ?? 0) + (totals?.files_removed ?? 0) + (totals?.files_modified ?? 0)),
    ],
  ];
  const last = [
    totals?.last_build_at && `built ${ago(totals.last_build_at)}`,
    totals?.last_test_at && `tested ${ago(totals.last_test_at)}`,
    current?.git_last_commit_at && `last commit ${ago(current.git_last_commit_at)}`,
  ].filter(Boolean);
  return (
    <div className="card">
      <div className="card-head">
        <h2>Saves, builds, tests</h2>
        {last.length > 0 && <span className="meta-inline muted small">{last.join(' · ')}</span>}
      </div>
      <dl className="wt">
        {items.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** `snapshot-agent reveal` for a hash, which names the file on the machine that made it. */
function RevealButton({ hash, project }: { hash: string; project: string }) {
  const [done, setDone] = useState(false);
  const cmd = `snapshot-agent reveal ${hash.slice(0, 12)} --project ${JSON.stringify(project)}`;
  return (
    <button
      className="copy-btn"
      title={`Copy: ${cmd}`}
      onClick={() => {
        navigator.clipboard
          ?.writeText(cmd)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
          .catch(() => undefined);
      }}
    >
      {done ? 'copied' : 'reveal'}
    </button>
  );
}

/** The repository's uncommitted state at the latest snapshot. Counts only. */
function WorkingTree({ p }: { p: ProjectRow }) {
  const items: [string, string][] = [
    ['Staged', num(p.git_staged)],
    ['Modified', num(p.git_modified)],
    ['Untracked', num(p.git_untracked)],
    ['Conflicted', num(p.git_conflicted)],
    ['Uncommitted lines', `+${num(p.git_insertions)} / −${num(p.git_deletions)}`],
    ['Stashes', num(p.git_stashes)],
    ['Ahead · behind', `${num(p.git_ahead)} · ${num(p.git_behind)}`],
    ['Commits on HEAD', num(p.git_commits)],
  ];
  return (
    <div className="card">
      <h2>
        Working tree now
        <SourceTag source="cli" />
        {(p.git_conflicted ?? 0) > 0 && <span className="pill bad">merge conflict</span>}
      </h2>
      <p className="sub">
        From <code>git status</code> and <code>git diff --shortstat</code> at the last snapshot
        {p.captured_at ? ` (${clock(p.captured_at)})` : ''}. Only counts leave your machine, never paths.
        {p.git_last_commit_at ? ` Last commit ${ago(p.git_last_commit_at)}.` : ''}
      </p>
      <dl className="wt">
        {items.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function HotFiles({ churn, project }: { churn: ChurnData | null; project: string }) {
  const files = churn?.files ?? [];
  const edits = churn?.source === 'edits';
  return (
    <div className="card">
      <h2>
        Most-revised files
        <SourceTag source="cli" />
      </h2>
      <p className="sub">
        {edits
          ? 'Ranked by lines added and removed, counted line by line by the agent.'
          : 'Ranked by net lines moved across revisions (this window predates per-line diffs).'}{' '}
        Paths leave your machine as salted hashes; press <em>reveal</em> to copy the command that names one locally.
      </p>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Path hash</th>
              <th>Lines moved</th>
              {edits && <th>+ / −</th>}
              {edits && <th>At end</th>}
              <th>Revisions</th>
              <th>Lines now</th>
              {edits && <th>Last edit</th>}
            </tr>
          </thead>
          <tbody>
            {files.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Nothing changed in this window.
                </td>
              </tr>
            )}
            {files.map((f) => (
              <tr key={f.path_hash}>
                <td className="hash">
                  {f.path_hash.slice(0, 12)}…
                  <RevealButton hash={f.path_hash} project={project} />
                </td>
                <td>{num(f.lines_moved)}</td>
                {edits && (
                  <td>
                    +{num(f.added)} / −{num(f.removed)}
                  </td>
                )}
                {edits && <td>{pct(f.tail, (f.tail ?? 0) + (f.mid ?? 0))}</td>}
                <td>{num(f.revisions)}</td>
                <td>{num(f.lines)}</td>
                {edits && <td>{f.last_edit ? clock(f.last_edit) : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Files sharing winnowed fingerprints with another file. Shared prints mean a
 * run of about 30 tokens matched after comments and whitespace were stripped:
 * copied, moved or generated code.
 */
function CopyDetection({ overlap, project }: { overlap: Overlap | null; project: string }) {
  if (!overlap) return null;
  const pairs = overlap.pairs;
  return (
    <div className="card">
      <h2>
        Shared code
        <SourceTag source="cli" />
      </h2>
      <p className="sub">
        Files whose code fingerprints match another file in your projects — the same 30-token runs after
        comments and whitespace are stripped, so a copy survives reformatting. {num(overlap.files_fingerprinted)}{' '}
        files here have fingerprints, compared against {num(overlap.files_compared)} across your account.
      </p>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Shared</th>
              <th>Matches</th>
              <th>In project</th>
            </tr>
          </thead>
          <tbody>
            {pairs.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  {overlap.files_fingerprinted === 0
                    ? 'No fingerprints yet. snapshot-agent 0.3 sends them for files as they change.'
                    : 'No file here shares code with another file.'}
                </td>
              </tr>
            )}
            {pairs.map((p) => {
              const share = p.prints ? p.shared / p.prints : 0;
              return (
                <tr key={`${p.path_hash}:${p.other_project}:${p.other_path_hash}`}>
                  <td className="hash">
                    {p.path_hash.slice(0, 12)}…
                    <RevealButton hash={p.path_hash} project={project} />
                    <div className="muted small">{num(p.lines)} lines</div>
                  </td>
                  <td>
                    <span className="share-bar">
                      <span style={{ width: `${Math.round(share * 100)}%` }} />
                    </span>
                    {Math.round(share * 100)}%
                    <div className="muted small">
                      {p.shared} of {p.prints} prints
                    </div>
                  </td>
                  <td className="hash">
                    {p.other_path_hash.slice(0, 12)}…
                    <RevealButton hash={p.other_path_hash} project={p.other_project} />
                    <div className="muted small">{num(p.other_lines)} lines</div>
                  </td>
                  <td>
                    {p.other_project === project ? (
                      <span className="muted">this project</span>
                    ) : (
                      <a href={href('projects', p.other_project)}>{p.other_project}</a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CHAIN_TEXT: Record<string, string> = {
  gap: 'Sequence skipped — snapshots were lost (queue overflow, or one never sent).',
  fork: 'The previous hash did not match the snapshot before it — history branched.',
  restart: 'Chain restarted at 1 — the agent’s state file was deleted or reset.',
};

/** How trustworthy and how cheap the capture is: chain, capture cost, skips, agent. */
function Integrity({
  totals,
  breaks,
  current,
}: {
  totals: Summary['totals'];
  breaks: ChainBreak[];
  current: ProjectRow | null;
}) {
  return (
    <details className="card disclosure" open={breaks.length > 0}>
      <summary className="card-head">
        <h2>Agent and integrity</h2>
        <span className="meta">
          {[
            current?.agent_version && `agent ${current.agent_version}`,
            !totals?.chained ? null : breaks.length === 0 ? 'chain intact' : plural(breaks.length, 'chain break'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </summary>
      <p className="sub">
        Each snapshot carries a sequence number and the hash of the one before it, so a missing or forged
        snapshot shows up as a break in the chain.
      </p>
      <dl className="wt">
        <div>
          <dt>Chain</dt>
          <dd>
            {!totals?.chained ? (
              '—'
            ) : breaks.length === 0 ? (
              <span className="pill ok">intact</span>
            ) : (
              <span className="pill warn">{breaks.length} breaks</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Capture time</dt>
          <dd>
            {totals?.avg_capture_ms !== null && totals?.avg_capture_ms !== undefined
              ? `${Math.round(totals.avg_capture_ms)} ms`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Slowest capture</dt>
          <dd>{totals?.max_capture_ms !== null && totals?.max_capture_ms !== undefined ? `${num(totals.max_capture_ms)} ms` : '—'}</dd>
        </div>
        <div>
          <dt>Files skipped</dt>
          <dd>{current?.skipped_files !== null && current?.skipped_files !== undefined ? num(current.skipped_files) : '—'}</dd>
        </div>
        <div>
          <dt>Fingerprinted</dt>
          <dd>{num(totals?.fingerprinted_files)}</dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>{current?.agent_version ?? '—'}</dd>
        </div>
        <div>
          <dt>Platform</dt>
          <dd>{current?.os ? `${current.os}/${current.arch}` : '—'}</dd>
        </div>
        <div>
          <dt>Repo size</dt>
          <dd>{current?.total_bytes ? bytes(current.total_bytes) : '—'}</dd>
        </div>
      </dl>
      {breaks.length > 0 && (
        <div className="scroll-x" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Seq</th>
                <th>What happened</th>
              </tr>
            </thead>
            <tbody>
              {breaks.map((b) => (
                <tr key={`${b.captured_at}:${b.seq}`}>
                  <td>{clock(b.captured_at)}</td>
                  <td>{num(b.seq)}</td>
                  <td>
                    <span className="pill warn">{b.chain}</span> {CHAIN_TEXT[b.chain]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {current?.skipped_files ? (
        <p className="sub" style={{ marginTop: 12, marginBottom: 0 }}>
          Skipped files are over 2 MB or unreadable; they are not counted in lines or the tree hash.
        </p>
      ) : null}
    </details>
  );
}

/**
 * Hackatime projects snapshot-agent has never seen, so the two lists together
 * cover everything Home counts. Matched by name only: a repo whose folder name
 * differs from its Hackatime project shows up here too.
 */
function HackatimeProjects({ ht, projects }: { ht: Hackatime | null; projects: ProjectRow[] }) {
  const ok = htOk(ht);
  if (ht && ht.configured && ht.error) return <div className="card"><p className="sub">{HT_ERRORS[ht.error]}</p></div>;
  if (!ok) return null;
  const known = new Set(projects.map((p) => p.name.toLowerCase()));
  const only = ok.projects.filter((p) => !known.has(p.name.toLowerCase()));
  if (only.length === 0) return null;

  return (
    <details className="card">
      <summary className="card-head" style={{ cursor: 'pointer', marginBottom: 0 }}>
        <h2>Only in Hackatime</h2>
        <span className="src-tag hackatime">{num(only.length)} projects</span>
        <span className="meta">snapshot-agent hasn’t seen these repos</span>
      </summary>
      <div className="scroll-x" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Editor time</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {only.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td>{humanDuration(p.total_seconds)}</td>
                <td className="muted">{Math.round(p.percent)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
