import { useEffect, useMemo, useState } from 'react';
import {
  SignedOutError,
  ago,
  bytes,
  clock,
  dayRange,
  getChurn,
  getCommits,
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
import {
  Filter,
  PageHead,
  RangeFilter,
  RangePills,
  SourceFilter,
  SourceTag,
  Tile,
  pct,
  showCli,
  showHt,
  type Source,
} from '../ui';
import { HT_ERRORS, htOk } from './Home';

const POLL_MS = 10_000;

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

function ProjectDetail({
  name,
  projects,
  days,
  setDays,
  ht,
  source,
  setSource,
}: Props & { name: string; projects: ProjectRow[] }) {
  const [timeline, setTimeline] = useState<SnapshotRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [commits, setCommits] = useState<CommitRow[]>([]);
  const [churn, setChurn] = useState<ChurnData | null>(null);
  const [rhythm, setRhythm] = useState<RhythmCell[]>([]);
  const [saves, setSaves] = useState<SavesByHour | null>(null);
  const [overlap, setOverlap] = useState<Overlap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);

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
        setCommits(cm.commits);
        setChurn(c);
        setRhythm(rh.cells);
        setSaves(sv);
        setOverlap(ov);
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
  const ok = showHt(source) ? htOk(ht) : null;
  const cli = showCli(source);
  const htProject = ok?.projects.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null;
  const netLines = (totals?.lines_added ?? 0) - (totals?.lines_removed ?? 0);
  // True diffs exist only from agent 0.3; before that every count is a net estimate.
  const exact = totals?.exact_added !== null && totals?.exact_added !== undefined;
  const hasSaves = totals?.saves !== null && totals?.saves !== undefined;
  const hasTree = current?.git_staged !== null && current?.git_staged !== undefined;
  const chainBreaks = (totals?.chain_gaps ?? 0) + (totals?.chain_forks ?? 0) + (totals?.chain_restarts ?? 0);

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
    const out = cli ? [{ label: 'Tree moving (snapshot CLI)', color: 'var(--series-1)', values: tree }] : [];
    if (ok) {
      out.push({
        label: 'Editor time (Hackatime, all projects)',
        color: 'var(--ht)',
        values: new Map(ok.daily.map((d) => [d.day, d.seconds])),
      });
    }
    return out;
  }, [sessions, ok, cli]);

  return (
    <>
      <a className="back" href={href('projects')}>
        ← All projects
      </a>
      <PageHead title={name}>
        <p className="lede">
          {current?.captured_at ? `Last snapshot ${clock(current.captured_at)}` : 'Waiting for the first snapshot'}
          {current?.agent_version && (
            <span className="muted">
              {' '}
              · agent {current.agent_version}
              {current.os ? ` on ${current.os}/${current.arch}` : ''}
            </span>
          )}
          {lastSync && <span className="live" title="Auto-refreshing every 10s" />}
        </p>
      </PageHead>

      <div className="filters">
        <RangeFilter days={days} onChange={setDays} />
        <SourceFilter source={source} onChange={setSource} />
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

      {cli && delayedTicks > 0 && (
        <div className="notice">
          <strong>{num(delayedTicks)}</strong> of these snapshots were replayed from the agent's offline queue,
          the latest arriving <strong>{humanDuration(maxLag)}</strong> after it was captured. Charts are plotted
          on the agent clock, so that work appears when it happened — not when it landed here.
        </div>
      )}

      <div className="tiles">
        {cli && (
          <>
            <Tile
              label="Lines"
              value={num(current?.total_lines)}
              sub={`${num(current?.file_count)} files${current?.total_bytes ? ` · ${bytes(current.total_bytes)}` : ''}`}
              accent
            />
            <Tile
              label="Active time"
              value={humanDuration(activeSeconds)}
              sub={`${sessions.length} sessions · longest ${humanDuration(longest)}`}
            />
          </>
        )}
        {ok && (
          <Tile
            label="Hackatime"
            value={htProject ? humanDuration(htProject.total_seconds) : '—'}
            sub={htProject ? 'editor time on this project' : 'no Hackatime project by this name'}
          />
        )}
        {cli && (
          <>
            <Tile
              label="Lines written"
              value={signed(netLines)}
              sub={`+${num(totals?.lines_added)} / −${num(totals?.lines_removed)}${exact ? '' : ' (net estimate)'}`}
            />
            <Tile
              label="Saves"
              value={hasSaves ? num(totals?.saves) : '—'}
              sub={
                hasSaves
                  ? activeSeconds > 0
                    ? `${Math.round(((totals?.saves ?? 0) / activeSeconds) * 3600)} per active hour`
                    : 'between snapshots'
                  : 'needs agent 0.3'
              }
            />
            <Tile
              label="Branch"
              value={current?.git_branch ?? '—'}
              sub={`${shortSha(current?.git_head)} · ${current?.git_dirty ? 'dirty' : 'clean'} · ${num(
                current?.git_ahead,
              )}↑ ${current?.git_behind !== null && current?.git_behind !== undefined ? `${num(current.git_behind)}↓` : ''}`}
            />
            <Tile
              label="Commits made"
              value={totals?.commits_made !== null && totals?.commits_made !== undefined ? num(totals.commits_made) : '—'}
              sub={
                current?.git_last_commit_at
                  ? `last ${ago(current.git_last_commit_at)} · ${num(current.git_commits)} total`
                  : `${num(totals?.commits)} HEADs worked on`
              }
            />
            <Tile
              label="Builds · tests"
              value={`${num(totals?.builds)} · ${num(totals?.tests)}`}
              sub={
                totals?.last_build_at || totals?.last_test_at
                  ? `built ${ago(totals?.last_build_at)} · tested ${ago(totals?.last_test_at)}`
                  : 'no build output or test cache touched'
              }
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
              label="History chain"
              value={!totals?.chained ? '—' : chainBreaks === 0 ? 'Intact' : `${chainBreaks} break${chainBreaks === 1 ? '' : 's'}`}
              sub={
                !totals?.chained
                  ? 'needs agent 0.3'
                  : `${num(totals.chained)} linked · seq ${num(current?.seq)}`
              }
            />
          </>
        )}
      </div>

      <div className="card">
        <h2>
          Coding time per day
          {cli && <SourceTag source="cli" />}
          {ok && <SourceTag source="hackatime" />}
        </h2>
        <p className="sub">
          {!cli
            ? 'Total editor time from Hackatime each day, across all projects: its daily totals are not split by project.'
            : ok
            ? 'How long this project’s tree was moving, beside total editor time from Hackatime.'
            : 'How long this project’s tree was moving each day.'}
        </p>
        <DailyTime days={dayList} series={timeSeries} />
      </div>

      {cli && (
        <>
          <div className="grid-2">
            <div className="card">
              <h2>
                Total lines
                <SourceTag source="cli" />
              </h2>
              <p className="sub">Every snapshot in the window, agent clock.</p>
              <TotalLines rows={timeline} />
            </div>
            <div className="card">
              <h2>
                Daily churn
                <SourceTag source="cli" />
              </h2>
              <p className="sub">
                Lines added above the line, removed below.
                {exact ? ' Counted line by line, so a rewritten line shows on both sides.' : ' Net change per snapshot.'}
              </p>
              <Churn rows={summary?.daily ?? []} />
            </div>
          </div>

          {hasTree && current && <WorkingTree p={current} />}

          <div className="grid-2">
            <div className="card">
              <h2>
                Saves by hour
                <SourceTag source="cli" />
              </h2>
              <p className="sub">
                Each time a file’s modified time moved between snapshots, in your timezone. The agent only stats
                files for this, it never opens them.
              </p>
              {saves && saves.total > 0 ? (
                <HourBars hours={saves.hours} unit="saves" />
              ) : (
                <div className="empty">No save times yet. They need snapshot-agent 0.3 running as a daemon.</div>
              )}
            </div>
            <div className="card">
              <h2>
                Where edits land
                <SourceTag source="cli" />
              </h2>
              <p className="sub">
                Changed lines in the last tenth of a file against everywhere before it. Writing new code mostly
                appends; refactoring and fixing mostly lands in the middle.
              </p>
              {(totals?.tail_edits ?? 0) + (totals?.mid_edits ?? 0) > 0 ? (
                <SplitBar
                  parts={[
                    { label: 'at the end of the file', value: totals?.tail_edits ?? 0, color: 'var(--cat-1)' },
                    { label: 'inside the file', value: totals?.mid_edits ?? 0, color: 'var(--cat-3)' },
                  ]}
                />
              ) : (
                <div className="empty">No per-line edits yet. They need snapshot-agent 0.3.</div>
              )}
            </div>
          </div>

          <div className="card">
            <h2>
              Weekly rhythm
              <SourceTag source="cli" />
            </h2>
            <p className="sub">When the tree moves, by weekday and hour in your timezone.</p>
            <Heatmap cells={rhythm} />
          </div>

          <div className="card">
            <h2>
              Sessions
              <SourceTag source="cli" />
            </h2>
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
                    <th>Saves</th>
                    <th>+ Lines</th>
                    <th>− Lines</th>
                    <th>Files touched</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">
                        No sessions in this window.
                      </td>
                    </tr>
                  )}
                  {sessions.map((s) => (
                    <tr key={s.started_at}>
                      <td>{clock(s.started_at)}</td>
                      <td>{humanDuration(s.seconds)}</td>
                      <td>{num(s.ticks)}</td>
                      <td>{hasSaves ? num(s.saves) : '—'}</td>
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
            <h2>
              Work per commit
              <SourceTag source="cli" />
            </h2>
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
                    <th>Committed</th>
                    <th>Worked on from</th>
                    <th>Span</th>
                    <th>Saves</th>
                    <th>+ Lines</th>
                    <th>− Lines</th>
                    <th>Files touched</th>
                  </tr>
                </thead>
                <tbody>
                  {commits.length === 0 && (
                    <tr>
                      <td colSpan={9} className="muted">
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
                      <td>{cm.committed_at ? clock(cm.committed_at) : '—'}</td>
                      <td>{clock(cm.first_seen)}</td>
                      <td>{humanDuration(cm.seconds)}</td>
                      <td>{cm.saves === null ? '—' : num(cm.saves)}</td>
                      <td>{num(cm.lines_added)}</td>
                      <td>{num(cm.lines_removed)}</td>
                      <td>{num(cm.files_touched)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <HotFiles churn={churn} project={name} />

          <CopyDetection overlap={overlap} project={name} />

          <Integrity totals={totals ?? null} breaks={summary?.breaks ?? []} current={current} />
        </>
      )}
    </>
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
    <div className="card">
      <h2>
        Agent and integrity
        <SourceTag source="cli" />
      </h2>
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
    </div>
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
