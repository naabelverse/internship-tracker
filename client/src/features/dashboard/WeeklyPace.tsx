import { useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/formatters';
import { HEAT_LEVEL_CLASSES, heatLevel } from '@/features/dashboard/heatLevels';
import type { Cell } from '@/features/dashboard/heatmapCells';
import {
  barPercent,
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
  /**
   * The plot's height. A fixed 80px unless the parent passes its own rule; the
   * plot and the panel both grow into any height their column has to spare.
   */
  plotClassName?: string;
  /** An explanation of the panel, set beside its title. */
  info?: ReactNode;
  /** Extra classes for the panel, such as a divider from the section above. */
  className?: string;
}

/**
 * Applications added per week against the weekly goal, one bar per heatmap
 * column. Status updates shade the heatmap but never count here.
 *
 * The bars sit on the same twelve-column grid and gaps as the heatmap, so at
 * the same width each one lines up under its week. They take the heatmap's
 * own levels and outline, and the dashed goal line is the card's subtle text
 * colour, so nothing here is a colour the card did not already use.
 */
export function WeeklyPace({
  cells,
  target,
  plotClassName = 'h-20',
  info,
  className,
}: WeeklyPaceProps): JSX.Element {
  const totals = useMemo(() => weeklyTotals(cells), [cells]);
  const scale = paceScale(totals, target);
  const busiest = totals.reduce((max, week) => Math.max(max, week.count), 0);
  const counts = totals.map((week) => String(week.count)).join(', ');
  const goalLabel = target > 0 ? ` Weekly goal: ${String(target)}.` : '';

  return (
    <div className={cn('flex flex-auto flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs text-content-subtle">Weekly pace</h3>
          {info}
        </div>
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
        className={cn(
          'relative grid flex-auto grid-cols-12 items-end gap-1 sm:gap-1.5',
          plotClassName,
        )}
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

        {/* The goal is drawn the way a bar is: a box standing on the plot's
            floor, as tall as a week of exactly the goal, with the same scale
            and floor, and its dashed stroke inside its top edge. A bar at the
            goal therefore shares the stroke's pixel row at any plot height or
            zoom. A border above a line placed at the goal sat 1px over that
            bar, which read as falling short. */}
        {target > 0 && (
          <span
            data-testid="pace-goal"
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 min-h-1 border-t border-dashed border-content-subtle"
            style={{ height: `${String(barPercent(target, scale))}%` }}
          />
        )}
      </div>

      <p className="text-xs text-content-subtle">
        {paceSummaryText(summarizePace(totals, target))}
      </p>
    </div>
  );
}
