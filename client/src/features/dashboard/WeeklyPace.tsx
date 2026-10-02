import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/formatters';
import { HEAT_LEVEL_CLASSES, heatLevel } from '@/features/dashboard/heatLevels';
import type { Cell } from '@/features/dashboard/heatmapCells';
import {
  barPercent,
  goalLinePercent,
  paceScale,
  paceSummaryText,
  summarizePace,
  weeklyTotals,
} from '@/features/dashboard/paceWeeks';

interface WeeklyPaceProps {
  /** The heatmap's own cells, so each bar is the sum of one of its columns. */
  cells: Cell[];
  /** The account's weekly goal; 0 means none is set. */
  target: number;
  className?: string;
}

/**
 * Applications per week against the weekly goal, one bar per heatmap column.
 *
 * The bars sit on the same twelve-column grid and gaps as the heatmap, so at
 * the same width each one lines up under its week. They take the heatmap's
 * own levels and outline, and the dashed goal line is the card's subtle text
 * colour, so nothing here is a colour the card did not already use.
 */
export function WeeklyPace({ cells, target, className }: WeeklyPaceProps): JSX.Element {
  const totals = useMemo(() => weeklyTotals(cells), [cells]);
  const scale = paceScale(totals, target);
  const busiest = totals.reduce((max, week) => Math.max(max, week.count), 0);
  const counts = totals.map((week) => String(week.count)).join(', ');
  const goalLabel = target > 0 ? ` Weekly goal: ${String(target)}.` : '';

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs text-content-subtle">Weekly pace</h3>
        {target > 0 && (
          <span
            className="flex items-center gap-1.5 text-[0.625rem] text-content-subtle"
            aria-hidden="true"
          >
            <span className="w-3 border-t border-dashed border-content-subtle" />
            Goal {target}
          </span>
        )}
      </div>

      <div
        className="relative grid h-20 grid-cols-12 items-end gap-1 sm:gap-1.5"
        role="img"
        aria-label={`Applications added per week, oldest first: ${counts}.${goalLabel}`}
      >
        {totals.map((week, index) => (
          <span
            key={week.start}
            data-testid="pace-bar"
            data-count={week.count}
            title={
              index === totals.length - 1
                ? `This week so far: ${String(week.count)} added`
                : `Week of ${formatDate(week.start)}: ${String(week.count)} added`
            }
            // A floor of 4px keeps an empty week visible as a column of its own.
            className={cn(
              'min-h-1 rounded-chip ring-1 ring-inset ring-border/60',
              HEAT_LEVEL_CLASSES[heatLevel(week.count, busiest)],
            )}
            style={{ height: `${String(barPercent(week.count, scale))}%` }}
          />
        ))}

        {target > 0 && (
          <span
            data-testid="pace-goal"
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-content-subtle"
            style={{ bottom: `${String(goalLinePercent(totals, target))}%` }}
          />
        )}
      </div>

      <p className="text-xs text-content-subtle">
        {paceSummaryText(summarizePace(totals, target))}
      </p>
    </div>
  );
}
