import { useMemo, useState } from 'react';
import { dayLabel, hours, humanDuration } from '../api';
import { useSize } from './useSize';

const DETAIL_PAD = { top: 14, right: 16, bottom: 26, left: 44 };
const OVERVIEW_PAD = { top: 8, right: 0, bottom: 26, left: 0 };
const DETAIL_HEIGHT = 200;
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

/** A round top for the axis: whole hours past an hour, half hours below. */
const niceMax = (s: number) => (s > 3600 ? Math.ceil(s / 7200) * 7200 : Math.ceil(s / 1800) * 1800);

/** How many evenly spaced dates the detail axis labels. */
const TICKS = 5;

/**
 * Time per day, one bar per series side by side. Both series are durations on
 * the same axis, so they share one scale — never a second y-axis.
 */
/**
 * `overview` is the Home variant: no y-axis or legend (the card header carries
 * it), every day labelled with its date, and the bar pairs spaced apart.
 */
export function DailyTime({
  days,
  series,
  overview,
  mark,
  legend = true,
}: {
  days: string[];
  series: TimeSeries[];
  overview?: boolean;
  /** False when the card header already names the series. */
  legend?: boolean;
  /** One day to call out on the axis, e.g. the only day a source saw anything. */
  mark?: { day: string; label: string };
}) {
  const PAD = overview ? OVERVIEW_PAD : DETAIL_PAD;
  const HEIGHT = overview ? 210 : DETAIL_HEIGHT;
  const { ref, width } = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const plot = useMemo(() => {
    const any = series.some((s) => [...s.values.values()].some((v) => v > 0));
    if (days.length === 0 || width === 0 || !any) return null;

    const w = width - PAD.left - PAD.right;
    const h = HEIGHT - PAD.top - PAD.bottom;
    const band = w / days.length;
    const peak = Math.max(...series.flatMap((s) => days.map((d) => s.values.get(d) ?? 0)), 60);
    const max = overview ? peak : niceMax(peak);
    const base = PAD.top + h;
    // The overview leaves a fifth of each day empty on either side.
    const inset = overview ? band * 0.1 : 0;
    const barW = Math.max((band - 2 * inset - GAP * (series.length + 1)) / series.length, 1);

    const groups = days.map((day, i) => ({
      day,
      center: PAD.left + i * band + band / 2,
      bars: series.map((s, j) => {
        const v = s.values.get(day) ?? 0;
        const x = PAD.left + i * band + inset + GAP + j * (barW + GAP);
        return { v, path: barPath(x, barW, base, base - (v / max) * h), color: s.color };
      }),
    }));

    // Evenly spaced dates, dropping any that would crowd the marked day.
    const at = (i: number) => PAD.left + i * band + band / 2;
    const markIdx = mark ? days.indexOf(mark.day) : -1;
    const n = Math.min(TICKS, days.length);
    const ticks = [...new Set(Array.from({ length: n }, (_, k) => Math.round((k * (days.length - 1)) / Math.max(1, n - 1))))]
      .filter((i) => markIdx < 0 || Math.abs(at(i) - at(markIdx)) > 90)
      .map((i) => ({ i, text: dayLabel(days[i]) }));
    if (mark && markIdx >= 0) ticks.push({ i: markIdx, text: `${dayLabel(mark.day)} · ${mark.label}` });

    return { groups, band, max, base, h, ticks, at };
  }, [days, series, width, overview, PAD, HEIGHT, mark]);

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
            {!overview && [0, 0.5, 1].map((f) => (
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
                  {f === 0 ? '0' : hours(plot.max * f)}
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
            {overview ? (
              plot.groups.map((g) => (
                <text key={g.day} x={g.center} y={HEIGHT - 6} fontSize={12} textAnchor="middle" fill="var(--text-muted)">
                  {Number(g.day.slice(8))}
                </text>
              ))
            ) : (
              plot.ticks.map((t) => {
                // The end labels hug the plot edges instead of overhanging them.
                const first = t.i === 0;
                const last = t.i === days.length - 1;
                return (
                  <text
                    key={t.i}
                    x={first ? PAD.left : last ? width - PAD.right : plot.at(t.i)}
                    y={HEIGHT - 6}
                    fontSize={11}
                    textAnchor={first ? 'start' : last ? 'end' : 'middle'}
                    fill="var(--text-muted)"
                  >
                    {t.text}
                  </text>
                );
              })
            )}
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

          {series.length > 1 && !overview && legend && (
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
