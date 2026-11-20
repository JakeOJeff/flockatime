/** "All time": ten years, the widest window the server serves. */
export const ALL_TIME = 3650;

export const RANGES = [
  { days: 1, label: 'Last 24 hours' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last year' },
  { days: ALL_TIME, label: 'All time' },
];

export const rangeLabel = (days: number) => RANGES.find((r) => r.days === days)?.label ?? `${days} days`;

/** A labelled filter in the row above the charts. */
export function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="filter">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function RangeFilter({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  return (
    <Filter label="Date range">
      <select value={days} onChange={(e) => onChange(Number(e.target.value))}>
        {RANGES.map((r) => (
          <option key={r.days} value={r.days}>
            {r.label}
          </option>
        ))}
      </select>
    </Filter>
  );
}

/**
 * Where a panel's numbers come from. The snapshot CLI (this server's agent) and
 * Hackatime (editor plugins, fetched from hackatime.hackclub.com) are separate
 * pipelines, so the dashboard can show either on its own to debug one of them.
 */
export type Source = 'all' | 'cli' | 'hackatime';

export const showCli = (s: Source) => s !== 'hackatime';
export const showHt = (s: Source) => s !== 'cli';

export function SourceFilter({ source, onChange }: { source: Source; onChange: (s: Source) => void }) {
  return (
    <Filter label="Data source">
      <select value={source} onChange={(e) => onChange(e.target.value as Source)}>
        <option value="all">All sources</option>
        <option value="cli">Snapshot CLI only</option>
        <option value="hackatime">Hackatime only</option>
      </select>
    </Filter>
  );
}

/** A small label naming a panel's source. */
export function SourceTag({ source }: { source: 'cli' | 'hackatime' }) {
  return <span className={`src-tag ${source}`}>{source === 'cli' ? 'Snapshot CLI' : 'Hackatime'}</span>;
}

/** `tone` colours the number by what it measures: Hackatime, snapshot-agent, or lines added. */
export function Tile({
  label,
  value,
  sub,
  accent,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  tone?: 'ht' | 'cli' | 'add';
}) {
  return (
    <div className={['tile', accent && 'accent', tone].filter(Boolean).join(' ')}>
      <div className="label">{label}</div>
      <div className="value" title={value}>
        {value}
      </div>
      {sub && <div className="delta">{sub}</div>}
    </div>
  );
}

export const pct = (part: number | null | undefined, whole: number | null | undefined) =>
  whole ? `${Math.round(((part ?? 0) / whole) * 100)}%` : '—';

/** Title and lede on the left; `aside` (usually range pills) on the right. */
export function PageHead({
  eyebrow,
  title,
  aside,
  children,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  aside?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {children}
      </div>
      {aside}
    </header>
  );
}

/** Segmented buttons; exactly one is pressed. */
export function Pills<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="pills" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const PILL_RANGES = [
  { value: 1, label: 'Today' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: ALL_TIME, label: 'All time' },
];

/** The date range as pills. `today` adds a one-day option (Home only). */
export function RangePills({ days, onChange, today }: { days: number; onChange: (d: number) => void; today?: boolean }) {
  return (
    <Pills
      label="Date range"
      value={days}
      options={today ? PILL_RANGES : PILL_RANGES.slice(1)}
      onChange={onChange}
    />
  );
}
