import { humanDuration } from '../api';
import { href } from '../App';

export interface CompareRow {
  name: string;
  /** Snapshot CLI active time; null when the CLI has no project by this name. */
  cli: number | null;
  /** Hackatime editor time; null when Hackatime has no project by this name. */
  ht: number | null;
  /** Links to the project page when the CLI knows the project. */
  link?: string;
}

/**
 * Snapshot CLI vs Hackatime time per project: two bars on one shared scale, so
 * a project's pair reads as a ratio and every project is comparable.
 */
export function CompareBars({
  rows,
  cliTotal,
  htTotal,
  limit = 6,
}: {
  rows: CompareRow[];
  cliTotal: number;
  /** Hackatime's total, or null when Hackatime is off or unavailable. */
  htTotal: number | null;
  limit?: number;
}) {
  if (rows.length === 0) return <div className="empty">Nothing recorded in this window.</div>;

  const shown = rows.slice(0, limit);
  const max = Math.max(...shown.flatMap((r) => [r.cli ?? 0, r.ht ?? 0]), 1);
  const bar = (v: number | null, cls: string) => (
    <span className="cmp-track">
      {v !== null && <span className={`cmp-bar ${cls}`} style={{ width: `${Math.max((v / max) * 100, v > 0 ? 1 : 0)}%` }} />}
    </span>
  );
  const value = (v: number | null, cls: string, what: string) => (
    <span className={`cmp-value ${cls}`} title={v === null ? `No ${what} project by this name` : undefined}>
      {v === null ? '—' : humanDuration(v)}
    </span>
  );

  return (
    <>
      <div className="cmp-legend">
        <span className="cmp-key cli">
          Snapshot CLI <strong>{humanDuration(cliTotal)}</strong>
        </span>
        {htTotal !== null && (
          <span className="cmp-key hackatime">
            Hackatime <strong>{humanDuration(htTotal)}</strong>
          </span>
        )}
      </div>
      <ul className="cmp">
        {shown.map((r) => (
          <li key={r.name}>
            <span className="rank-name" title={r.name}>
              {r.link ? <a href={r.link}>{r.name}</a> : r.name}
            </span>
            <span className="cmp-bars">
              {bar(r.cli, 'cli')}
              {bar(r.ht, 'hackatime')}
            </span>
            <span className="cmp-values">
              {value(r.cli, 'cli', 'Snapshot CLI')}
              {value(r.ht, 'hackatime', 'Hackatime')}
            </span>
          </li>
        ))}
      </ul>
      {rows.length > shown.length && <p className="sub cmp-more">{rows.length - shown.length} more projects not shown.</p>}
    </>
  );
}

/** Joins the CLI's projects and Hackatime's by case-insensitive name, biggest first. */
export function compareRows(
  cli: { name: string; active_seconds: number }[],
  ht: { name: string; total_seconds: number }[] | null,
): CompareRow[] {
  const rows = new Map<string, CompareRow>();
  for (const p of cli) {
    rows.set(p.name.toLowerCase(), { name: p.name, cli: p.active_seconds, ht: null, link: href('projects', p.name) });
  }
  for (const p of ht ?? []) {
    const row = rows.get(p.name.toLowerCase());
    if (row) row.ht = p.total_seconds;
    else rows.set(p.name.toLowerCase(), { name: p.name, cli: null, ht: p.total_seconds });
  }
  return [...rows.values()]
    .filter((r) => (r.cli ?? 0) > 0 || (r.ht ?? 0) > 0)
    .sort((a, b) => Math.max(b.cli ?? 0, b.ht ?? 0) - Math.max(a.cli ?? 0, a.ht ?? 0));
}
