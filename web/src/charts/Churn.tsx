import { useMemo, useState } from 'react';
import type { DailyRow } from '../api';
import { dayLabel, num } from '../api';
import { useSize } from './useSize';

const PAD = { top: 14, right: 16, bottom: 26, left: 52 };
const HEIGHT = 220;
const GAP = 2; // surface gap between adjacent bars
const R = 4; // rounded data-end

/**
 * Bars rounded only at the data-end and square where they meet the baseline, so
 * the zero line stays a hard edge.
 */
function barPath(x: number, w: number, base: number, end: number): string {
  const up = end < base;
  const h = Math.abs(base - end);
  const r = Math.min(R, w / 2, h);
  if (h <= 0.5) return '';
  return up
    ? `M${x},${base} L${x},${end + r} Q${x},${end} ${x + r},${end} L${x + w - r},${end} Q${x + w},${end} ${x + w},${end + r} L${x + w},${base} Z`
    : `M${x},${base} L${x},${end - r} Q${x},${end} ${x + r},${end} L${x + w - r},${end} Q${x + w},${end} ${x + w},${end - r} L${x + w},${base} Z`;
}

/**
 * Above/below a baseline, so this is the diverging job: blue and red as warm/cool
 * poles with zero as the neutral midpoint. Two series, so a legend is always
 * present — identity never rests on color alone.
 */
export function Churn({ rows }: { rows: DailyRow[] }) {
  const { ref, width } = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const plot = useMemo(() => {
    if (rows.length === 0 || width === 0) return null;

    const w = width - PAD.left - PAD.right;
    const h = HEIGHT - PAD.top - PAD.bottom;
    const band = w / rows.length;
    const barW = Math.max(band - GAP, 1);

    const up = Math.max(...rows.map((r) => r.lines_added ?? 0), 1);
    const down = Math.max(...rows.map((r) => r.lines_removed ?? 0), 1);
    const total = up + down;

    // The baseline sits where zero actually falls, so bar heights stay comparable
    // across the two arms instead of each arm being scaled to its own max.
    const zero = PAD.top + (up / total) * h;
    const scale = h / total;

    const bars = rows.map((r, i) => {
      const x = PAD.left + i * band + GAP / 2;
      const added = r.lines_added ?? 0;
      const removed = r.lines_removed ?? 0;
      return {
        row: r,
        x,
        w: barW,
        added,
        removed,
        addPath: barPath(x, barW, zero, zero - added * scale),
        remPath: barPath(x, barW, zero, zero + removed * scale),
        center: x + barW / 2,
      };
    });

    return { bars, zero, band, h, up, down };
  }, [rows, width]);

  const active = plot && hover !== null ? plot.bars[hover] : null;

  return (
    <div className="chart-shell" ref={ref}>
      {plot === null ? (
        <div className="empty">No activity in this window.</div>
      ) : (
        <>
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label="Lines added and removed per day"
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const idx = Math.floor((e.clientX - box.left - PAD.left) / plot.band);
              setHover(idx >= 0 && idx < plot.bars.length ? idx : null);
            }}
          >
            <text x={PAD.left - 8} y={PAD.top + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
              {plot.up.toLocaleString()}
            </text>
            <text
              x={PAD.left - 8}
              y={HEIGHT - PAD.bottom}
              textAnchor="end"
              fontSize={11}
              fill="var(--text-muted)"
            >
              {plot.down.toLocaleString()}
            </text>

            {plot.bars.map((b, i) => (
              <g key={b.row.day} opacity={hover === null || hover === i ? 1 : 0.45}>
                {b.addPath && <path d={b.addPath} fill="var(--series-1)" />}
                {b.remPath && <path d={b.remPath} fill="var(--series-2)" />}
              </g>
            ))}

            {/* Zero line drawn last so it reads as the axis, not as a gridline. */}
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={plot.zero}
              y2={plot.zero}
              stroke="var(--border)"
              strokeWidth={1}
            />

            {rows.length > 0 && (
              <>
                <text x={PAD.left} y={HEIGHT - 6} fontSize={11} fill="var(--text-muted)">
                  {dayLabel(rows[0].day)}
                </text>
                <text
                  x={width - PAD.right}
                  y={HEIGHT - 6}
                  fontSize={11}
                  textAnchor="end"
                  fill="var(--text-muted)"
                >
                  {dayLabel(rows[rows.length - 1].day)}
                </text>
              </>
            )}
          </svg>

          {active && (
            <div
              className="tip"
              style={{
                left: Math.min(Math.max(active.center + 10, 8), Math.max(width - 160, 8)),
                top: 8,
              }}
            >
              <div className="t-label">{dayLabel(active.row.day)}</div>
              <div className="t-row">
                <span>Added</span>
                <strong>+{num(active.added)}</strong>
              </div>
              <div className="t-row">
                <span>Removed</span>
                <strong>−{num(active.removed)}</strong>
              </div>
              <div className="t-row">
                <span>Active ticks</span>
                <strong>{num(active.row.active_ticks)}</strong>
              </div>
            </div>
          )}

          <div className="legend">
            <span className="key">
              <i style={{ background: 'var(--series-1)' }} /> Lines added
            </span>
            <span className="key">
              <i style={{ background: 'var(--series-2)' }} /> Lines removed
            </span>
          </div>
        </>
      )}
    </div>
  );
}
