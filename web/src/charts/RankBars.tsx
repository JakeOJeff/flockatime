import { humanDuration } from '../api';

export interface RankRow {
  name: string;
  seconds: number;
  percent: number;
  /** Marks the row that matches the project open in the dashboard. */
  current?: boolean;
}

/**
 * Ranked share of time. One series, so one hue and no legend; the name and
 * value are always printed, so the bar is never the only carrier.
 */
export function RankBars({ rows, limit = 8 }: { rows: RankRow[]; limit?: number }) {
  if (rows.length === 0) return <div className="empty">Nothing recorded in this window.</div>;

  const shown = rows.slice(0, limit);
  const rest = rows.slice(limit);
  if (rest.length > 0) {
    shown.push({
      name: `${rest.length} more`,
      seconds: rest.reduce((a, r) => a + r.seconds, 0),
      percent: rest.reduce((a, r) => a + r.percent, 0),
    });
  }
  const max = Math.max(...shown.map((r) => r.seconds), 1);

  return (
    <ul className="rank">
      {shown.map((r) => (
        <li key={r.name} className={r.current ? 'current' : undefined}>
          <span className="rank-name" title={r.name}>
            {r.name}
          </span>
          <span className="rank-track">
            <span className="rank-bar" style={{ width: `${Math.max((r.seconds / max) * 100, 1)}%` }} />
          </span>
          <span className="rank-value">
            {humanDuration(r.seconds)} <span className="muted">{r.percent.toFixed(0)}%</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
