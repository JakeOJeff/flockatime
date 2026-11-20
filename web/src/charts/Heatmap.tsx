import { useState } from 'react';
import type { RhythmCell } from '../api';
import { num } from '../api';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Monday first: the working week reads left to right, the weekend at the end.
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const HOUR_LABELS = new Set([0, 6, 12, 18]);

const hourLabel = (h: number) =>
  new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

/**
 * Weekday × hour activity. Magnitude, so one hue stepped light → dark (the
 * cell's tint of --series-1 over the surface); empty cells stay the plain grid
 * color so "nothing" never reads as "a little".
 */
/** `compact` fits a half-width card: smaller cells, each cell's numbers in its tooltip. */
export function Heatmap({ cells, compact }: { cells: RhythmCell[]; compact?: boolean }) {
  const [hover, setHover] = useState<RhythmCell | null>(null);

  const byKey = new Map(cells.map((c) => [`${c.dow}:${c.hour}`, c]));
  const max = Math.max(...cells.map((c) => c.active_ticks), 1);

  if (cells.length === 0) return <div className="empty">No tree movement in this window.</div>;

  return (
    <div className={compact ? 'heatmap compact' : 'heatmap'}>
      <div className="hm-grid" onMouseLeave={() => setHover(null)}>
        {ORDER.map((dow) => (
          <div className="hm-row" key={dow}>
            <span className="hm-day">{DAYS[dow]}</span>
            {Array.from({ length: 24 }, (_, hour) => {
              const cell = byKey.get(`${dow}:${hour}`);
              // Floor at 18% so the lightest real cell is still visibly filled.
              const pct = cell ? Math.round(18 + (cell.active_ticks / max) * 82) : 0;
              return (
                <span
                  key={hour}
                  className="hm-cell"
                  style={{
                    background: cell
                      ? `color-mix(in oklab, var(--series-1) ${pct}%, var(--surface-1))`
                      : 'var(--grid)',
                  }}
                  title={
                    compact
                      ? `${DAYS[dow]} ${hourLabel(hour)}: ${num(cell?.active_ticks ?? 0)} active ticks, ${num(
                          cell?.lines_moved ?? 0,
                        )} lines moved`
                      : undefined
                  }
                  onMouseEnter={() => setHover(cell ?? { dow, hour, active_ticks: 0, lines_moved: 0 })}
                />
              );
            })}
          </div>
        ))}
        <div className="hm-row hm-axis">
          <span className="hm-day" />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="hm-hour">
              {HOUR_LABELS.has(h) ? hourLabel(h) : ''}
            </span>
          ))}
        </div>
      </div>
      {!compact && <div className="hm-readout muted">
        {hover
          ? `${DAYS[hover.dow]} ${hourLabel(hover.hour)} — ${num(hover.active_ticks)} active ticks, ${num(
              hover.lines_moved,
            )} lines moved`
          : 'Hover a cell for its numbers. Darker = more snapshots where the tree moved.'}
      </div>}
    </div>
  );
}
