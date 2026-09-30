import { useState } from 'react';
import { humanDuration } from '../api';

export interface Slice {
  name: string;
  seconds: number;
  percent: number;
}

// Five named slices plus "Other": past that, a pie stops being readable and
// the palette runs out of hues that stay distinct under colour-blindness.
const SHOWN = 5;
const SIZE = 180;
const R_OUT = SIZE / 2;
const R_IN = R_OUT * 0.6;

function arc(a0: number, a1: number): string {
  // A lone full slice is a ring; an arc from 0 to 2π would collapse to nothing.
  if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4;
  const p = (r: number, a: number) => `${R_OUT + r * Math.sin(a)},${R_OUT - r * Math.cos(a)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(R_OUT, a0)} A${R_OUT},${R_OUT} 0 ${large} 1 ${p(R_OUT, a1)} L${p(R_IN, a1)} A${R_IN},${R_IN} 0 ${large} 0 ${p(R_IN, a0)} Z`;
}

/**
 * Share of time. Top five slices take categorical slots 1–5 in rank order and
 * the rest fold into a gray "Other", so a long tail never invents a hue. The
 * legend prints every name and share, so colour is never the only carrier.
 */
export function Donut({ rows, label }: { rows: Slice[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length === 0) return <div className="empty">Nothing recorded in this window.</div>;

  const sorted = [...rows].sort((a, b) => b.seconds - a.seconds);
  const shown = sorted.slice(0, SHOWN).map((r, i) => ({ ...r, color: `var(--cat-${i + 1})` }));
  const rest = sorted.slice(SHOWN);
  if (rest.length > 0) {
    shown.push({
      name: rest.length === 1 ? rest[0].name : `Other (${rest.length})`,
      seconds: rest.reduce((a, r) => a + r.seconds, 0),
      percent: rest.reduce((a, r) => a + r.percent, 0),
      color: 'var(--cat-other)',
    });
  }

  const total = shown.reduce((a, r) => a + r.seconds, 0) || 1;
  let angle = 0;
  const slices = shown.map((r) => {
    const a0 = angle;
    angle += (r.seconds / total) * Math.PI * 2;
    return { ...r, d: arc(a0, angle) };
  });
  const focus = hover === null ? null : slices[hover];

  return (
    <div className="donut">
      <div className="donut-figure">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label={`${label}: ${slices.map((s) => `${s.name} ${s.percent.toFixed(0)}%`).join(', ')}`}
          onMouseLeave={() => setHover(null)}
        >
          {slices.map((s, i) => (
            <path
              key={s.name}
              d={s.d}
              fill={s.color}
              stroke="var(--surface-1)"
              strokeWidth={2}
              opacity={hover === null || hover === i ? 1 : 0.35}
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>
        <div className="donut-center" aria-hidden>
          <strong>{focus ? `${focus.percent.toFixed(0)}%` : humanDuration(total)}</strong>
          <span>{focus ? focus.name : 'total'}</span>
        </div>
      </div>
      <ul className="donut-legend">
        {slices.map((s, i) => (
          <li
            key={s.name}
            className={hover === i ? 'on' : undefined}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <i style={{ background: s.color }} />
            <span className="rank-name" title={s.name}>
              {s.name}
            </span>
            <span className="muted">{humanDuration(s.seconds)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
