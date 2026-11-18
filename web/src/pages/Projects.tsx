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
import { InstallCard } from '../ConnectCli';
import {
  Filter,
  PageHead,
  RangeFilter,
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

function ProjectList({ projects, ht, days, setDays, source, setSource }: Props & { projects: ProjectRow[] }) {
  const ok = showHt(source) ? htOk(ht) : null;
  const htTime = (name: string) =>
    ok?.projects.find((p) => p.name.toLowerCase() === name.toLowerCase())?.total_seconds ?? null;
  const newest = newestVersion(projects.map((p) => p.agent_version));

  return (
    <>
      <PageHead eyebrow="flockatime" title="Projects">
        <p className="lede">Every git repo the agent has snapshotted. Open one for its lines, churn and sessions.</p>
      </PageHead>

      {source === 'hackatime' ? (
        <>
          <div className="filters">
            <RangeFilter days={days} onChange={setDays} />
            <SourceFilter source={source} onChange={setSource} />
          </div>
          <HackatimeProjects ht={ht} projects={projects} />
        </>
      ) : projects.length === 0 ? (
        <InstallCard intro />
      ) : (
        <>
          <div className="filters">
            <RangeFilter days={days} onChange={setDays} />
            <SourceFilter source={source} onChange={setSource} />
          </div>
          <div className="pgrid">
            {projects.map((p) => {
              const t = htTime(p.name);
              return (
                <a key={p.name} className="pcard" href={href('projects', p.name)}>
                  <div className="pcard-name">{p.name}</div>
                  <div className="pcard-times">
                    <div title="Active time in this window, from the snapshot CLI's sessions">
                      <div className="pcard-time">{humanDuration(p.active_seconds)}</div>
                      <div className="pcard-src cli">Snapshot CLI</div>
                    </div>
                    {ok && (
                      <div title="Editor time on this project in this window, from Hackatime">
                        <div className="pcard-time">{t === null ? '—' : humanDuration(t)}</div>
                        <div className="pcard-src hackatime">Hackatime</div>
                      </div>
                    )}
                  </div>
                  <div className="pcard-meta">
                    <span>{num(p.total_lines)} lines</span>
                    <span>{num(p.file_count)} files</span>
                    <span>{p.git_branch ?? 'no branch'}</span>
                  </div>
                  <div className="pcard-meta">
                    <span title="Lines added and removed in this window">
                      +{num(p.window.lines_added)} / −{num(p.window.lines_removed)}
                    </span>
                    {p.window.saves !== null && <span>{num(p.window.saves)} saves</span>}
                    {p.window.builds > 0 && <span>{num(p.window.builds)} builds</span>}
                  </div>
                  <ProjectFlags p={p} newest={newest} />
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

/** What needs attention on a project, from its latest snapshot and this window. */
function ProjectFlags({ p, newest }: { p: ProjectRow; newest: string | null }) {
  const uncommitted = (p.git_insertions ?? 0) + (p.git_deletions ?? 0);
  const flags: [string, string, string][] = [];
  if ((p.git_conflicted ?? 0) > 0) flags.push(['bad', 'conflict', 'Files in merge conflict']);
  if (uncommitted > 0)
    flags.push(['muted-pill', `${num(uncommitted)} uncommitted`, 'Lines changed against HEAD, not yet committed']);
  else if (p.git_dirty) flags.push(['muted-pill', 'dirty', 'Uncommitted changes']);
  if ((p.git_behind ?? 0) > 0) flags.push(['muted-pill', `${p.git_behind} behind`, 'Commits behind upstream']);
  if (p.window.chain_breaks > 0)
    flags.push(['warn', `${p.window.chain_breaks} chain break${p.window.chain_breaks === 1 ? '' : 's'}`, 'Snapshots missing, forked or restarted']);
  if (newest && p.agent_version && p.agent_version !== newest)
    flags.push(['warn', `agent ${p.agent_version}`, `Older than ${newest}, the newest agent reporting here`]);
  if (flags.length === 0) return null;
  return (
    <div className="pcard-flags">
      {flags.map(([cls, text, title]) => (
        <span key={text} className={`pill ${cls}`} title={title}>
          {text}
        </span>
      ))}
    </div>
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
        color: 'var(--cat-2)',
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
 * Hackatime's own project list, beside whether the snapshot CLI knows a
 * project by the same name. Hackatime and the CLI are matched by name only, so
 * a project missing on one side here is why its tile reads "—" on the other.
 */
function HackatimeProjects({ ht, projects }: { ht: Hackatime | null; projects: ProjectRow[] }) {
  if (ht === null) return <div className="card empty">Loading Hackatime…</div>;
  if (!ht.configured) return <div className="card empty">Hackatime is not connected. See Settings.</div>;
  if (ht.error) return <div className="card empty">{HT_ERRORS[ht.error]}</div>;
  const cliNames = new Map(projects.map((p) => [p.name.toLowerCase(), p]));

  return (
    <div className="card">
      <h2>
        Hackatime projects
        <SourceTag source="hackatime" />
      </h2>
      <p className="sub">
        Editor time per project, beside the snapshot CLI's active time for a project by the same name.
      </p>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Editor time</th>
              <th>Share</th>
              <th>Snapshot CLI time</th>
            </tr>
          </thead>
          <tbody>
            {ht.projects.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Nothing recorded in this window.
                </td>
              </tr>
            )}
            {ht.projects.map((p) => {
              const match = cliNames.get(p.name.toLowerCase());
              return (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td>{humanDuration(p.total_seconds)}</td>
                  <td>{Math.round(p.percent)}%</td>
                  <td>
                    {match ? (
                      <a href={href('projects', match.name)}>{humanDuration(match.active_seconds)}</a>
                    ) : (
                      <span className="muted">Not snapshotted</span>
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
