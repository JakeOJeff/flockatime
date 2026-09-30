import { useMemo, useState } from 'react';
import { dayLabel, hours, humanDuration } from '../api';
import { useSize } from './useSize';

const PAD = { top: 14, right: 16, bottom: 26, left: 44 };
const HEIGHT = 200;
const GAP = 2; // surface gap between adjacent bars
const R = 4; // rounded data-end

export interface TimeSeries {
  label: string;
  color: string;
  /** Seconds per day, keyed YYYY-MM-DD. */
  values: Map<string, number>;
}

function barPath(x: number, w: number, base: number, top: number): string {
  const h = base - top;
  if (h <= 0.5) return '';
  const r = Math.min(R, w / 2, h);
  return `M${x},${base} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + w - r},${top} Q${x + w},${top} ${x + w},${top + r} L${x + w},${base} Z`;
}

/**
 * Time per day, one bar per series side by side. Both series are durations on
 * the same axis, so they share one scale — never a second y-axis.
 */
export function DailyTime({ days, series }: { days: string[]; series: TimeSeries[] }) {
  const { ref, width } = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const plot = useMemo(() => {
    const any = series.some((s) => [...s.values.values()].some((v) => v > 0));
    if (days.length === 0 || width === 0 || !any) return null;

    const w = width - PAD.left - PAD.right;
    const h = HEIGHT - PAD.top - PAD.bottom;
    const band = w / days.length;
    const max = Math.max(...series.flatMap((s) => days.map((d) => s.values.get(d) ?? 0)), 60);
    const base = PAD.top + h;
    const barW = Math.max((band - GAP * (series.length + 1)) / series.length, 1);

    const groups = days.map((day, i) => ({
      day,
      center: PAD.left + i * band + band / 2,
      bars: series.map((s, j) => {
        const v = s.values.get(day) ?? 0;
        const x = PAD.left + i * band + GAP + j * (barW + GAP);
        return { v, path: barPath(x, barW, base, base - (v / max) * h), color: s.color };
      }),
    }));

    return { groups, band, max, base, h };
  }, [days, series, width]);

  const active = plot && hover !== null ? plot.groups[hover] : null;

  return (
    <div className="chart-shell" ref={ref}>
      {plot === null ? (
        <div className="empty">No coding time in this window.</div>
      ) : (
        <>
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Time per day: ${series.map((s) => s.label).join(' and ')}`}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const idx = Math.floor((e.clientX - box.left - PAD.left) / plot.band);
              setHover(idx >= 0 && idx < plot.groups.length ? idx : null);
            }}
          >
            {[0.5, 1].map((f) => (
              <g key={f}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={plot.base - f * plot.h}
                  y2={plot.base - f * plot.h}
                  stroke="var(--grid)"
                />
                <text
                  x={PAD.left - 8}
                  y={plot.base - f * plot.h + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--text-muted)"
                >
                  {hours(plot.max * f)}
                </text>
              </g>
            ))}

            {plot.groups.map((g, i) => (
              <g key={g.day} opacity={hover === null || hover === i ? 1 : 0.45}>
                {g.bars.map((b, j) => b.path && <path key={j} d={b.path} fill={b.color} />)}
              </g>
            ))}

            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={plot.base}
              y2={plot.base}
              stroke="var(--border)"
            />
            <text x={PAD.left} y={HEIGHT - 6} fontSize={11} fill="var(--text-muted)">
              {dayLabel(days[0])}
            </text>
            <text x={width - PAD.right} y={HEIGHT - 6} fontSize={11} textAnchor="end" fill="var(--text-muted)">
              {dayLabel(days[days.length - 1])}
            </text>
          </svg>

          {active && (
            <div
              className="tip"
              style={{ left: Math.min(Math.max(active.center + 10, 8), Math.max(width - 180, 8)), top: 8 }}
            >
              <div className="t-label">{dayLabel(active.day)}</div>
              {series.map((s, j) => (
                <div className="t-row" key={s.label}>
                  <span>
                    <i className="swatch" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <strong>{humanDuration(active.bars[j].v)}</strong>
                </div>
              ))}
            </div>
          )}

          {series.length > 1 && (
            <div className="legend">
              {series.map((s) => (
                <span className="key" key={s.label}>
                  <i style={{ background: s.color }} /> {s.label}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
