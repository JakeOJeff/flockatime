import { useState } from 'react';

const label = (h: number) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);

/**
 * One count per local hour of day, 0–23. A single series, so one hue; the
 * hovered hour's count is printed below, so the bar is never the only carrier.
 */
export function HourBars({ hours, unit }: { hours: number[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...hours, 1);
  const total = hours.reduce((a, b) => a + b, 0);
  if (total === 0) return <div className="empty">Nothing recorded in this window.</div>;
  const peak = hours.indexOf(Math.max(...hours));
  const shown = hover ?? peak;

  return (
    <div className="hourbars">
      <div className="hb-plot" onMouseLeave={() => setHover(null)}>
        {hours.map((v, h) => (
          <div
            key={h}
            className={h === shown ? 'hb-col on' : 'hb-col'}
            onMouseEnter={() => setHover(h)}
            title={`${label(h)}: ${v.toLocaleString()} ${unit}`}
          >
            <div className="hb-bar" style={{ height: `${v ? Math.max((v / max) * 100, 3) : 0}%` }} />
          </div>
        ))}
      </div>
      <div className="hb-axis">
        {hours.map((_, h) => (
          <span key={h}>{h % 6 === 0 ? label(h) : ''}</span>
        ))}
      </div>
      <div className="hm-readout">
        {hover === null ? 'Busiest hour' : 'Hour'} <strong>{label(shown)}</strong> ·{' '}
        {hours[shown].toLocaleString()} {unit}
      </div>
    </div>
  );
}

/**
 * Two parts of one whole as a single bar, each part labelled with its share.
 */
export function SplitBar({
  parts,
}: {
  parts: { label: string; value: number; color: string; hint?: string }[];
}) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (total === 0) return <div className="empty">Nothing recorded in this window.</div>;
  return (
    <div className="splitbar">
      <div className="sb-track">
        {parts.map((p) =>
          p.value > 0 ? (
            <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
          ) : null,
        )}
      </div>
      <ul className="sb-legend">
        {parts.map((p) => (
          <li key={p.label}>
            <i style={{ background: p.color }} />
            <strong>{Math.round((p.value / total) * 100)}%</strong> {p.label}
            <span className="muted"> · {p.value.toLocaleString()} lines</span>
            {p.hint && <div className="muted small">{p.hint}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
