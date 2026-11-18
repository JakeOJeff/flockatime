import { useEffect, useMemo, useState } from 'react';
import {
  clock,
  dayRange,
  getHackatime,
  humanDuration,
  listProjects,
  localDay,
  num,
  type Hackatime,
  type HackatimeSlice,
  type ProjectRow,
} from '../api';
import { href, type User } from '../App';
import { Donut } from '../charts/Donut';
import { DailyTime } from '../charts/DailyTime';
import { RankBars } from '../charts/RankBars';
import { CompareBars, compareRows } from '../charts/CompareBars';
import {
  PageHead,
  RangeFilter,
  SourceFilter,
  SourceTag,
  Tile,
  rangeLabel,
  showCli,
  showHt,
  type Source,
} from '../ui';

export const HT_ERRORS: Record<string, string> = {
  not_found:
    'Hackatime has no account matching your Hack Club sign-in. Set HACKATIME_USER or the HACKATIME_API_KEY secret.',
  private: 'Your Hackatime stats are private. Set the HACKATIME_API_KEY secret to read them.',
  bad_key: 'Hackatime rejected the HACKATIME_API_KEY secret. Check it on hackatime.hackclub.com.',
  unavailable: 'Hackatime could not be reached. It will be retried when you change the date range.',
};

type HtOk = Extract<Hackatime, { username: string | null }>;
export const htOk = (ht: Hackatime | null): HtOk | null =>
  ht && ht.configured && !ht.error ? ht : null;

const top = (rows: HackatimeSlice[] | undefined) => rows?.[0]?.name ?? '—';

function greeting(name: string | null) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name.split(' ')[0]}` : part;
}

const slices = (rows: HackatimeSlice[]) =>
  rows.map((r) => ({ name: r.name, seconds: r.total_seconds, percent: r.percent }));

/** Account-wide totals from the snapshot CLI over the selected range. */
function CliTiles({ projects }: { projects: ProjectRow[] }) {
  const sum = (f: (p: ProjectRow) => number | null | undefined) => projects.reduce((a, p) => a + (f(p) ?? 0), 0);
  const added = sum((p) => p.window.lines_added);
  const removed = sum((p) => p.window.lines_removed);
  const hasSaves = projects.some((p) => p.window.saves !== null);
  const uncommitted = sum((p) => (p.git_insertions ?? 0) + (p.git_deletions ?? 0));
  const dirty = projects.filter((p) => p.git_dirty).length;
  const active = projects.filter((p) => p.window.snapshots > 0).length;
  const breaks = sum((p) => p.window.chain_breaks);

  return (
    <div className="tiles six">
      <Tile label="Snapshot CLI time" value={humanDuration(sum((p) => p.active_seconds))} sub={`${active} of ${projects.length} projects active`} accent />
      <Tile label="Lines written" value={`+${num(added)}`} sub={`−${num(removed)} removed`} />
      <Tile label="Saves" value={hasSaves ? num(sum((p) => p.window.saves)) : '—'} sub={hasSaves ? 'between snapshots' : 'needs agent 0.3'} />
      <Tile label="Builds · tests" value={`${num(sum((p) => p.window.builds))} · ${num(sum((p) => p.window.tests))}`} sub="output and cache touches" />
      <Tile label="Uncommitted" value={num(uncommitted)} sub={`lines across ${dirty} dirty repo${dirty === 1 ? '' : 's'}`} />
      <Tile label="History chain" value={breaks === 0 ? 'Intact' : `${num(breaks)} breaks`} sub="missing or forked snapshots" />
    </div>
  );
}

export function Home({
  user,
  days,
  setDays,
  ht,
  source,
  setSource,
}: {
  user: User | null;
  days: number;
  setDays: (d: number) => void;
  ht: Hackatime | null;
  source: Source;
  setSource: (s: Source) => void;
}) {
  const [today, setToday] = useState<HtOk | null>(null);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);

  // The headline sentence is always about the last day, whatever the range.
  useEffect(() => {
    getHackatime(1)
      .then((r) => setToday(htOk(r)))
      .catch(() => undefined);
  }, []);

  // Active time follows the range, so it lines up with Hackatime's numbers.
  useEffect(() => {
    let live = true;
    listProjects(days)
      .then((r) => live && setProjects(r.projects))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [days]);

  const ok = showHt(source) ? htOk(ht) : null;
  const latest = projects?.reduce((m, p) => Math.max(m, p.received_at ?? 0), 0) || null;
  const dayList = useMemo(() => dayRange(Math.min(days, 90)), [days]);
  const series = useMemo(
    () =>
      ok
        ? [{ label: 'Coding time', color: 'var(--series-1)', values: new Map(ok.daily.map((d) => [d.day, d.seconds])) }]
        : [],
    [ok],
  );
  const todaySeconds = today?.daily.find((d) => d.day === localDay(Date.now() / 1000))?.seconds ?? 0;

  // Both sources side by side, per project. Hackatime's half is left out when
  // it is filtered off or unavailable, leaving the CLI's time on its own.
  const cliTotal = projects?.reduce((a, p) => a + p.active_seconds, 0) ?? 0;
  const compare = showCli(source) && projects && projects.length + (ok?.projects.length ?? 0) > 0 && (
    <div className="card">
      <h2>
        {ok ? 'Snapshot CLI vs Hackatime' : 'Snapshot CLI time by project'}
        <SourceTag source="cli" />
        {ok && <SourceTag source="hackatime" />}
      </h2>
      <p className="sub">
        {rangeLabel(days)}. Snapshot CLI counts the time your files were changing; Hackatime counts all editor time,
        reading included, so it usually runs higher. Projects are matched by name.
      </p>
      <CompareBars
        rows={compareRows(projects, ok?.projects ?? null)}
        cliTotal={cliTotal}
        htTotal={ok ? ok.total_seconds : null}
      />
    </div>
  );

  return (
    <>
      <PageHead
        eyebrow={greeting(user?.name ?? null)}
        title={
          <>
            WE are watching <em>your</em> coding time
          </>
        }
      >
        <p className="lede">
          {source === 'cli'
            ? projects === null
              ? ' '
              : `${projects.length} project${projects.length === 1 ? '' : 's'} snapshotted${
                  latest ? `, last received ${clock(latest)}` : ''
                }.`
            : today === null
            ? ' '
            : todaySeconds > 0
              ? `Today, you've logged ${humanDuration(todaySeconds)}${
                  today.languages[0] ? ` across ${today.languages[0].name}` : ''
                }${today.editors[0] ? ` using ${today.editors[0].name}` : ''}.`
              : 'Nothing logged yet today. Open an editor and it will show up here.'}
        </p>
      </PageHead>

      <div className="filters">
        <RangeFilter days={days} onChange={setDays} />
        <SourceFilter source={source} onChange={setSource} />
      </div>

      {showHt(source) && ht === null && <div className="card empty">Loading Hackatime…</div>}
      {showHt(source) && ht && !ht.configured && (
        <div className="card empty">Sign in, or set HACKATIME_USER / HACKATIME_API_KEY, to show Hackatime stats.</div>
      )}
      {showHt(source) && ht && ht.configured && ht.error && <div className="card empty">{HT_ERRORS[ht.error]}</div>}

      {showCli(source) && projects && projects.length > 0 && <CliTiles projects={projects} />}

      {!ok && compare}

      {ok && (
        <>
          <div className="tiles six">
            <Tile label="Total time" value={humanDuration(ok.total_seconds)} accent />
            <Tile label="Top project" value={top(ok.projects)} />
            <Tile label="Top language" value={top(ok.languages)} />
            <Tile label="Top OS" value={top(ok.operating_systems)} />
            <Tile label="Top editor" value={top(ok.editors)} />
            <Tile label="Top category" value={top(ok.categories)} />
          </div>

          {compare}

          <div className="grid-2">
            <div className="card">
              <h2>
                Project durations
                <SourceTag source="hackatime" />
              </h2>
              <RankBars
                limit={10}
                rows={ok.projects.map((p) => ({ name: p.name, seconds: p.total_seconds, percent: p.percent }))}
              />
            </div>
            <div className="card">
              <h2>
                Languages
                <SourceTag source="hackatime" />
              </h2>
              <Donut label="Languages" rows={slices(ok.languages)} />
            </div>
            <div className="card">
              <h2>
                Editors
                <SourceTag source="hackatime" />
              </h2>
              <Donut label="Editors" rows={slices(ok.editors)} />
            </div>
            <div className="card">
              <h2>
                Operating systems
                <SourceTag source="hackatime" />
              </h2>
              <Donut label="Operating systems" rows={slices(ok.operating_systems)} />
            </div>
          </div>

          <div className="card">
            <h2>
              Coding time per day
              <SourceTag source="hackatime" />
            </h2>
            <p className="sub">
              {days > 90 ? 'The last 90 days' : rangeLabel(days)}, averaging {humanDuration(ok.daily_average)} a
              day.
            </p>
            <DailyTime days={dayList} series={series} />
          </div>
        </>
      )}

      {showCli(source) && projects && projects.length > 0 && (
        <div className="card">
          <h2>
            Snapshotted by flockatime
            <SourceTag source="cli" />
          </h2>
          <p className="sub">
            Projects the agent is watching, with their active time in this range
            {ok ? ' beside Hackatime’s editor time' : ''}. Open one for its lines, churn and sessions.
          </p>
          <ul className="plist">
            {projects.map((p) => {
              const htp = ok?.projects.find((h) => h.name.toLowerCase() === p.name.toLowerCase());
              return (
                <li key={p.name}>
                  <a href={href('projects', p.name)}>
                    <span className="rank-name">{p.name}</span>
                    <span className="muted">
                      <span className="time-cli" title="Snapshot CLI active time">
                        {humanDuration(p.active_seconds)}
                      </span>
                      {ok && (
                        <>
                          {' · '}
                          <span className="time-ht" title="Hackatime editor time">
                            {htp ? humanDuration(htp.total_seconds) : '—'}
                          </span>
                        </>
                      )}
                      {' · '}
                      +{num(p.window.lines_added)}/−{num(p.window.lines_removed)}
                      {p.window.saves !== null ? ` · ${num(p.window.saves)} saves` : ''}
                      {' · '}
                      {num(p.total_lines)} lines · {p.captured_at ? clock(p.captured_at) : 'no snapshot'}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {showCli(source) && projects && projects.length === 0 && (
        <div className="card">
          <h2>No projects yet</h2>
          <p className="sub">
            Install the agent from <a href={href('extensions')}>Extensions</a> and your projects will appear
            here as you edit them.
          </p>
        </div>
      )}
    </>
  );
}
