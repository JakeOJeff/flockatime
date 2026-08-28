import { useMemo, useState } from 'react';
import type { SnapshotRow } from '../api';
import { clock, num } from '../api';
import { useSize } from './useSize';

const PAD = { top: 12, right: 16, bottom: 26, left: 52 };
const HEIGHT = 220;

/**
 * Trend over time, one series. A single series needs no legend box — the card
 * title names it — and gets a crosshair plus tooltip, which is the default for
 * a line chart in HTML.
 */
export function TotalLines({ rows }: { rows: SnapshotRow[] }) {
  const { ref, width } = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const plot = useMemo(() => {
    if (rows.length < 2 || width === 0) return null;

    const w = width - PAD.left - PAD.right;
    const h = HEIGHT - PAD.top - PAD.bottom;

    const t0 = rows[0].captured_at;
    const t1 = rows[rows.length - 1].captured_at;
    const span = Math.max(t1 - t0, 1);

    const values = rows.map((r) => r.total_lines);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    // Give a flat series a visible band instead of a divide-by-zero.
    const pad = hi === lo ? Math.max(hi * 0.05, 1) : (hi - lo) * 0.12;
    const yMin = Math.max(0, lo - pad);
    const yMax = hi + pad;

    const x = (t: number) => PAD.left + ((t - t0) / span) * w;
    const y = (v: number) => PAD.top + h - ((v - yMin) / (yMax - yMin)) * h;

    const pts = rows.map((r) => ({ px: x(r.captured_at), py: y(r.total_lines), row: r }));
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(' ');
    const area = `${line} L${pts[pts.length - 1].px.toFixed(1)},${(PAD.top + h).toFixed(1)} L${pts[0].px.toFixed(1)},${(PAD.top + h).toFixed(1)} Z`;

    const ticks = Array.from({ length: 4 }, (_, i) => {
      const v = yMin + ((yMax - yMin) * i) / 3;
      return { v, py: y(v) };
    });

    return { w, h, pts, line, area, ticks, t0, t1 };
  }, [rows, width]);

  const active = plot && hover !== null ? plot.pts[hover] : null;

  return (
    <div className="chart-shell" ref={ref}>
      {plot === null ? (
        <div className="empty">Not enough snapshots yet.</div>
      ) : (
        <>
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label="Total lines over time"
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const mx = e.clientX - box.left;
              // Nearest point wins, so the hit target is far wider than the mark.
              let best = 0;
              let bestDist = Infinity;
              plot.pts.forEach((p, i) => {
                const d = Math.abs(p.px - mx);
                if (d < bestDist) {
                  bestDist = d;
                  best = i;
                }
              });
              setHover(best);
            }}
          >
            {/* Recessive grid, and value labels in ink rather than the series color. */}
            {plot.ticks.map((t) => (
              <g key={t.v}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={t.py}
                  y2={t.py}
                  stroke="var(--grid)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={t.py + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--text-muted)"
                >
                  {Math.round(t.v).toLocaleString()}
                </text>
              </g>
            ))}

            <path d={plot.area} fill="var(--series-1)" opacity={0.1} />
            <path
              d={plot.line}
              fill="none"
              stroke="var(--series-1)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {active && (
              <g>
                <line
                  x1={active.px}
                  x2={active.px}
                  y1={PAD.top}
                  y2={PAD.top + plot.h}
                  stroke="var(--text-muted)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                {/* 2px surface ring keeps the marker legible over the line. */}
                <circle
                  cx={active.px}
                  cy={active.py}
                  r={5}
                  fill="var(--series-1)"
                  stroke="var(--surface-1)"
                  strokeWidth={2}
                />
              </g>
            )}

            <text x={PAD.left} y={HEIGHT - 6} fontSize={11} fill="var(--text-muted)">
              {clock(plot.t0)}
            </text>
            <text
              x={width - PAD.right}
              y={HEIGHT - 6}
              fontSize={11}
              textAnchor="end"
              fill="var(--text-muted)"
            >
              {clock(plot.t1)}
            </text>
          </svg>

          {active && (
            <div
              className="tip"
              style={{
                left: Math.min(Math.max(active.px + 12, 8), Math.max(width - 170, 8)),
                top: Math.max(active.py - 52, 4),
              }}
            >
              <div className="t-label">{clock(active.row.captured_at)}</div>
              <div className="t-row">
                <span>Lines</span>
                <strong>{num(active.row.total_lines)}</strong>
              </div>
              <div className="t-row">
                <span>Files</span>
                <strong>{num(active.row.file_count)}</strong>
              </div>
              {active.row.git_branch && (
                <div className="t-row">
                  <span>Branch</span>
                  <strong>
                    {active.row.git_branch}
                    {active.row.git_dirty ? ' •' : ''}
                  </strong>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
