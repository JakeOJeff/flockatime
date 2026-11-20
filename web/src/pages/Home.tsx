import { useEffect, useMemo, useState } from 'react';
import {
  dayRange,
  getCliDaily,
  getHackatime,
  humanDuration,
  listKeys,
  listProjects,
  localDay,
  newestVersion,
  num,
  type Hackatime,
  type HackatimeSlice,
  type MachineRow,
  type ProjectRow,
} from '../api';
import { href, type User } from '../App';
import { DailyTime } from '../charts/DailyTime';
import { PageHead, RangePills, Tile } from '../ui';

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

/** Why Hackatime has no numbers, or null when it has them (or is still loading). */
const htProblem = (ht: Hackatime | null): string | null =>
  !ht ? null : !ht.configured ? 'Hackatime is not connected.' : ht.error ? HT_ERRORS[ht.error] : null;

function greeting(name: string | null) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name.split(' ')[0]}` : part;
}

/** "Nov 18 at 10:01 PM" */
const when = (unix: number) => {
  const d = new Date(unix * 1000);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
};

const CHART_DAYS = 14;
const PROJECT_ROWS = 8;
const LANGUAGES_SHOWN = 5;

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
  const [recent, setRecent] = useState<HtOk | null>(null);
  const [cliDaily, setCliDaily] = useState<Map<string, number> | null>(null);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [machines, setMachines] = useState<MachineRow[] | null>(null);

  // The headline and the 14-day chart ignore the range: they are always about now.
  useEffect(() => {
    getHackatime(1)
      .then((r) => setToday(htOk(r)))
      .catch(() => undefined);
    getHackatime(CHART_DAYS)
      .then((r) => setRecent(htOk(r)))
      .catch(() => undefined);
    getCliDaily(CHART_DAYS)
      .then((r) => setCliDaily(new Map(r.daily.map((d) => [d.day, d.seconds]))))
      .catch(() => setCliDaily(new Map()));
    listKeys()
      .then((r) => setMachines(r.keys))
      .catch(() => setMachines([]));
  }, []);

  useEffect(() => {
    let live = true;
    listProjects(days)
      .then((r) => live && setProjects(r.projects))
      .catch(() => live && setProjects([]));
    return () => {
      live = false;
    };
  }, [days]);

  const ok = htOk(ht);
  const sum = (f: (p: ProjectRow) => number | null | undefined) =>
    (projects ?? []).reduce((a, p) => a + (f(p) ?? 0), 0);

  const latest = projects?.reduce<ProjectRow | null>(
    (m, p) => ((p.received_at ?? 0) > (m?.received_at ?? 0) ? p : m),
    null,
  );
  const todaySeconds = today?.daily.find((d) => d.day === localDay(Date.now() / 1000))?.seconds ?? 0;

  return (
    <>
      <PageHead title={greeting(user?.name ?? null)} aside={<RangePills days={days} onChange={setDays} today />}>
        <p className="lede">
          {todaySeconds > 0
            ? `Today you've logged ${humanDuration(todaySeconds)}${today?.languages[0] ? `, mostly ${today.languages[0].name}` : ''}.`
            : 'Nothing logged yet today.'}
          {latest?.received_at ? (
            <>
              {' '}
              Last session: <strong>{latest.name}</strong>, {when(latest.received_at)}.
            </>
          ) : null}
        </p>
      </PageHead>

      <div className="kpis">
        <Tile
          tone="ht"
          label="Editor time"
          value={ok ? humanDuration(ok.total_seconds) : '—'}
          sub={ok ? `from Hackatime · ${num(ok.projects.length)} projects` : htProblem(ht) ?? 'Loading Hackatime…'}
        />
        <Tile
          tone="cli"
          label="Captured"
          value={projects ? humanDuration(sum((p) => p.active_seconds)) : '—'}
          sub={projects ? `by snapshot-agent · ${num(projects.length)} repo${projects.length === 1 ? '' : 's'}` : ' '}
        />
        <Tile
          tone="add"
          label="Lines written"
          value={projects ? `+${compact(sum((p) => p.window.lines_added))}` : '—'}
          sub={projects ? `${num(sum((p) => p.window.lines_removed))} removed` : ' '}
        />
        <Health projects={projects} machines={machines} />
      </div>

      <RecentDays ht={recent} cli={cliDaily} problem={htProblem(ht)} />

      {projects && projects.length === 0 && !ok ? (
        <div className="card">
          <h2>No projects yet</h2>
          <p className="sub">
            Set up snapshot-agent from <a href={href('extensions')}>Extensions</a> and your repos appear here as you
            edit them.
          </p>
        </div>
      ) : (
        <div className="home-grid">
          <ProjectsCard ht={ok} projects={projects ?? []} />
          <LanguagesCard ht={ok} />
        </div>
      )}
    </>
  );
}

/** 122,600 → "122.6k"; small numbers stay exact. */
function compact(n: number): string {
  if (n < 10_000) return n.toLocaleString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** Is the snapshot data trustworthy, and is every machine current? */
function Health({ projects, machines }: { projects: ProjectRow[] | null; machines: MachineRow[] | null }) {
  const p = projects ?? [];
  const breaks = p.reduce((a, x) => a + x.window.chain_breaks, 0);
  const hasSaves = p.some((x) => x.window.saves !== null);
  const saves = p.reduce((a, x) => a + (x.window.saves ?? 0), 0);
  const builds = p.reduce((a, x) => a + x.window.builds, 0);
  const tests = p.reduce((a, x) => a + x.window.tests, 0);

  const live = (machines ?? []).filter((m) => !m.revoked_at && m.agent_version);
  const newest = newestVersion([...live.map((m) => m.agent_version), ...p.map((x) => x.agent_version)]);
  const old = (v: string | null) => !!(newest && v && v !== newest && /^\d/.test(v));
  // Machines say how many installs are behind; snapshots sent before keys were
  // recorded only say which versions are, so count whichever finds more.
  const outdated = Math.max(
    live.filter((m) => old(m.agent_version)).length,
    new Set(p.filter((x) => old(x.agent_version)).map((x) => x.agent_version)).size,
  );

  return (
    <div className="tile">
      <div className="label">Health</div>
      <dl className="health">
        <div>
          <dt>History chain</dt>
          <dd className={breaks === 0 ? 'ok' : 'warn'}>{breaks === 0 ? 'Intact' : `${num(breaks)} breaks`}</dd>
        </div>
        <div>
          <dt>Saves · builds · tests</dt>
          <dd>{`${hasSaves ? num(saves) : '—'} · ${num(builds)} · ${num(tests)}`}</dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd className={outdated ? 'warn' : newest ? 'ok' : undefined}>
            {machines === null ? '…' : !newest ? 'none yet' : outdated ? `${outdated} outdated` : 'up to date'}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** The last two weeks, both sources side by side per day. */
function RecentDays({ ht, cli, problem }: { ht: HtOk | null; cli: Map<string, number> | null; problem: string | null }) {
  const days = useMemo(() => dayRange(CHART_DAYS), []);
  const series = useMemo(
    () => [
      ...(ht ? [{ label: 'Hackatime', color: 'var(--ht)', values: new Map(ht.daily.map((d) => [d.day, d.seconds])) }] : []),
      ...(cli ? [{ label: 'Snapshot CLI', color: 'var(--cli)', values: cli }] : []),
    ],
    [ht, cli],
  );
  // Both sources measure the same coding, so a day counts whichever saw more of it.
  const total = days.reduce((a, d) => a + Math.max(0, ...series.map((s) => s.values.get(d) ?? 0)), 0);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Last {CHART_DAYS} days</h2>
        {ht && <span className="src-tag hackatime">Hackatime</span>}
        <span className="src-tag cli">Snapshot CLI</span>
        {total > 0 && (
          <span className="meta">
            {humanDuration(total)} total · about {humanDuration(total / CHART_DAYS)} a day
          </span>
        )}
      </div>
      {problem && <p className="sub">{problem}</p>}
      <DailyTime days={days} series={series} overview />
    </div>
  );
}

interface DuoRow {
  name: string;
  ht: number | null;
  cli: number | null;
}

/** Hackatime and snapshot-agent time per project, matched by name. */
function ProjectsCard({ ht, projects }: { ht: HtOk | null; projects: ProjectRow[] }) {
  const rows = useMemo(() => {
    const byName = new Map<string, DuoRow>();
    for (const p of ht?.projects ?? []) byName.set(p.name.toLowerCase(), { name: p.name, ht: p.total_seconds, cli: null });
    for (const p of projects) {
      const r = byName.get(p.name.toLowerCase());
      if (r) r.cli = p.active_seconds;
      else byName.set(p.name.toLowerCase(), { name: p.name, ht: null, cli: p.active_seconds });
    }
    return [...byName.values()].sort((a, b) => (b.ht ?? 0) - (a.ht ?? 0) || (b.cli ?? 0) - (a.cli ?? 0));
  }, [ht, projects]);

  const max = Math.max(1, ...rows.map((r) => Math.max(r.ht ?? 0, r.cli ?? 0)));
  const tracked = new Set(projects.map((p) => p.name.toLowerCase()));
  const bar = (v: number | null) => (v ? `max(7px, ${(v / max) * 100}%)` : '0');

  return (
    <div className="card">
      <div className="card-head">
        <h2>Projects</h2>
        {ht && <span className="meta-inline muted small">Hackatime includes reading time, so it runs higher</span>}
        <span className="meta">
          <a href={href('projects')}>See all {num(rows.length)} →</a>
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="empty">Nothing in this range.</div>
      ) : (
        <ul className="duo">
          {rows.slice(0, PROJECT_ROWS).map((r) => {
            const isTracked = tracked.has(r.name.toLowerCase());
            return (
              <li key={r.name}>
                <a href={isTracked ? href('projects', r.name) : href('projects')}>
                  <span className="duo-name" title={r.name}>
                    {r.name}
                  </span>
                  <span className="duo-bars" aria-hidden>
                    {r.ht ? <span className="ht" style={{ width: bar(r.ht) }} /> : null}
                    {r.cli ? <span className="cli" style={{ width: bar(r.cli) }} /> : null}
                  </span>
                  <span className="duo-v ht" title="Hackatime editor time">
                    {r.ht !== null ? humanDuration(r.ht) : '—'}
                  </span>
                  <span
                    className={isTracked ? 'duo-v cli' : 'duo-v none'}
                    title={isTracked ? 'Time snapshot-agent saw files changing' : 'snapshot-agent has not seen this repo'}
                  >
                    {isTracked ? humanDuration(r.cli ?? 0) : 'untracked'}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function LanguagesCard({ ht }: { ht: HtOk | null }) {
  const langs = ht?.languages ?? [];
  const shown = langs.slice(0, LANGUAGES_SHOWN).map((l, i) => ({ ...l, color: `var(--cat-${i + 1})` }));
  const rest = langs.slice(LANGUAGES_SHOWN);
  const parts: (HackatimeSlice & { color: string })[] = rest.length
    ? [
        ...shown,
        {
          name: `${rest.length} more`,
          total_seconds: rest.reduce((a, l) => a + l.total_seconds, 0),
          percent: rest.reduce((a, l) => a + l.percent, 0),
          color: 'var(--cat-other)',
        },
      ]
    : shown;
  const total = langs.reduce((a, l) => a + l.total_seconds, 0);
  const editor = ht?.editors[0]?.name;
  const os = ht?.operating_systems[0]?.name;

  return (
    <div className="card">
      <div className="card-head">
        <h2>Languages</h2>
        {total > 0 && <span className="meta">{humanDuration(total)}</span>}
      </div>
      {parts.length === 0 ? (
        <div className="empty">{ht ? 'No languages in this range.' : 'Languages come from Hackatime.'}</div>
      ) : (
        <>
          <div className="stack" role="img" aria-label="Share of time by language">
            {parts.map((p) => (
              <span key={p.name} style={{ flexGrow: p.total_seconds, background: p.color }} title={p.name} />
            ))}
          </div>
          <ul className="stack-legend">
            {parts.map((p) => (
              <li key={p.name}>
                <i style={{ background: p.color }} />
                <b>{p.name}</b>
                <span className="pct">{Math.round(p.percent)}%</span>
                <span className="t">{humanDuration(p.total_seconds)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {ht && (
        <p className="foot-note">
          {editor || os
            ? `Mostly ${[editor, os && `on ${os}`].filter(Boolean).join(' ')}.`
            : 'Editor, OS and category show up once your Hackatime plugin reports them.'}
        </p>
      )}
    </div>
  );
}
