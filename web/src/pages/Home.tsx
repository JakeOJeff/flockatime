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
import { PageHead, RangeFilter, Tile, rangeLabel } from '../ui';

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

export function Home({
  user,
  days,
  setDays,
  ht,
}: {
  user: User | null;
  days: number;
  setDays: (d: number) => void;
  ht: Hackatime | null;
}) {
  const [today, setToday] = useState<HtOk | null>(null);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);

  // The headline sentence is always about the last day, whatever the range.
  useEffect(() => {
    getHackatime(1)
      .then((r) => setToday(htOk(r)))
      .catch(() => undefined);
    listProjects()
      .then((r) => setProjects(r.projects))
      .catch(() => undefined);
  }, []);

  const ok = htOk(ht);
  const dayList = useMemo(() => dayRange(Math.min(days, 90)), [days]);
  const series = useMemo(
    () =>
      ok
        ? [{ label: 'Coding time', color: 'var(--series-1)', values: new Map(ok.daily.map((d) => [d.day, d.seconds])) }]
        : [],
    [ok],
  );
  const todaySeconds = today?.daily.find((d) => d.day === localDay(Date.now() / 1000))?.seconds ?? 0;

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
          {today === null
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
      </div>

      {ht === null && <div className="card empty">Loading Hackatime…</div>}
      {ht && !ht.configured && (
        <div className="card empty">Sign in, or set HACKATIME_USER / HACKATIME_API_KEY, to show Hackatime stats.</div>
      )}
      {ht && ht.configured && ht.error && <div className="card empty">{HT_ERRORS[ht.error]}</div>}

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

          <div className="grid-2">
            <div className="card">
              <h2>Project durations</h2>
              <RankBars
                limit={10}
                rows={ok.projects.map((p) => ({ name: p.name, seconds: p.total_seconds, percent: p.percent }))}
              />
            </div>
            <div className="card">
              <h2>Languages</h2>
              <Donut label="Languages" rows={slices(ok.languages)} />
            </div>
            <div className="card">
              <h2>Editors</h2>
              <Donut label="Editors" rows={slices(ok.editors)} />
            </div>
            <div className="card">
              <h2>Operating systems</h2>
              <Donut label="Operating systems" rows={slices(ok.operating_systems)} />
            </div>
          </div>

          <div className="card">
            <h2>Coding time per day</h2>
            <p className="sub">
              {days > 90 ? 'The last 90 days' : rangeLabel(days)}, averaging {humanDuration(ok.daily_average)} a
              day.
            </p>
            <DailyTime days={dayList} series={series} />
          </div>
        </>
      )}

      {projects && projects.length > 0 && (
        <div className="card">
          <h2>Snapshotted by flockatime</h2>
          <p className="sub">Projects the agent is watching. Open one for its lines, churn and sessions.</p>
          <ul className="plist">
            {projects.map((p) => (
              <li key={p.name}>
                <a href={href('projects', p.name)}>
                  <span className="rank-name">{p.name}</span>
                  <span className="muted">
                    {num(p.total_lines)} lines · {p.captured_at ? clock(p.captured_at) : 'no snapshot'}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {projects && projects.length === 0 && (
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
