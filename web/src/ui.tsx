export const RANGES = [
  { days: 1, label: 'Last 24 hours' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last year' },
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

export function Tile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className={accent ? 'tile accent' : 'tile'}>
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

export function PageHead({ eyebrow, title, children }: { eyebrow?: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="page-head">
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1>{title}</h1>
      {children}
    </header>
  );
}
