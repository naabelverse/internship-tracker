import { useMemo } from 'react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/formatters';
import { FollowThrough } from '@/features/dashboard/FollowThrough';
import { WeeklyPace } from '@/features/dashboard/WeeklyPace';
import { HEAT_LEVEL_CLASSES, heatLevel } from '@/features/dashboard/heatLevels';
import { buildCells } from '@/features/dashboard/heatmapCells';
import type { TimelinePoint } from '@/types/analytics';

interface ActivityHeatmapProps {
  /** Daily buckets; anything coarser cannot fill a per-day grid. */
  points: TimelinePoint[] | undefined;
  /** The account's IANA zone, which the server bucketed the days in. */
  timeZone: string;
  /** The account's weekly goal, which the pace panel draws its line at. */
  weeklyGoal: number;
  isLoading: boolean;
}

/** Monday first, matching the week the analytics aggregation buckets on. */
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Weekday labels, the grid, and the side column (follow-through over weekly
 * pace), as one CSS grid whose second column is the heatmap's: up to `max-w-md` (28rem), which puts a cell
 * at about 32px and the grid at 259px tall, level with the 256px plots in the
 * chart cards above.
 *
 * Narrow, the side column takes the row under the legend in that same column,
 * so each pace bar sits directly under its week. From a 48rem card it moves
 * beside the grid instead, behind a 1rem spacer track: the grid keeps its full 28rem
 * and the panel gets at least 260px, up to 28rem, where its bars match the
 * cells' pitch exactly. It is a container query, not a viewport breakpoint,
 * because the room beside the grid is not monotonic in the viewport: the
 * sidebar arriving at `lg` takes 256px, so a 1024 window leaves about 186px
 * beside the grid while a 1023 one, with the sidebar in a drawer, leaves 457.
 */
const LAYOUT =
  'mt-4 grid grid-cols-[auto_minmax(0,28rem)] justify-start gap-x-2 gap-y-4 [@container_(min-width:48rem)]:grid-cols-[auto_28rem_1rem_minmax(0,28rem)]';

/**
 * Follow-through over weekly pace, stacked under the legend in the grid's
 * column, or beside the grid and legend. Beside, the column spans both rows
 * and `justify-between` keeps the pace bars level with the legend, where they
 * sat alone, while the figures take the empty top of the column beside the
 * grid's first rows. Neither is tall enough to grow those rows, so the card
 * keeps its height there.
 */
const SIDE_COLUMN =
  'col-start-2 row-start-3 flex flex-col gap-4 [@container_(min-width:48rem)]:col-start-4 [@container_(min-width:48rem)]:row-span-2 [@container_(min-width:48rem)]:row-start-1 [@container_(min-width:48rem)]:justify-between';

/**
 * Activity per day over the last twelve weeks, and per week against the goal.
 *
 * CSS grid rather than Chart.js, which SPEC section 6 calls for explicitly: 84
 * coloured squares need no canvas, and as real elements each one can carry its
 * own title and its own row in the table below.
 */
export function ActivityHeatmap({
  points,
  timeZone,
  weeklyGoal,
  isLoading,
}: ActivityHeatmapProps): JSX.Element {
  const cells = useMemo(() => buildCells(points ?? [], new Date(), timeZone), [points, timeZone]);
  const busiest = cells.reduce((max, cell) => Math.max(max, cell.count), 0);
  const total = cells.reduce((sum, cell) => sum + cell.count, 0);
  const activeDays = cells.filter((cell) => cell.count > 0).length;

  return (
    // The card is the query container, so the layout follows the room the card
    // actually has rather than the window's width.
    <Card as="section" className="[container-type:inline-size]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="panel-title">Activity</h2>
        <p className="text-xs text-content-subtle">Last 12 weeks</p>
      </div>

      {isLoading ? (
        // The loaded layout's own tracks, with the grid's 12:7 shape, so the
        // card does not jump when it loads.
        <div className={LAYOUT}>
          <span className="w-5" aria-hidden="true" />
          <Skeleton className="aspect-[12/7] w-full" label="Loading activity" />
          <span className="col-span-2 h-4" aria-hidden="true" />
          <div className={SIDE_COLUMN} aria-hidden="true">
            {/* The figures' 71px: a label, a numeral and the summary line. */}
            <div className="skeleton h-[4.5rem]" />
            <div className="skeleton h-32" />
          </div>
        </div>
      ) : (
        <div className={LAYOUT}>
          {/* Seven rows on the same gap as the cells, stretched to the grid's
              height, so each label stays centred on its row at any cell size. */}
          <ul
            className="grid grid-rows-7 gap-1 text-[0.625rem] text-content-subtle sm:gap-1.5"
            aria-hidden="true"
          >
            {WEEKDAY_LABELS.map((day, index) => (
              <li
                key={day}
                className={cn('flex items-center leading-3', index % 2 === 1 && 'invisible')}
              >
                {day}
              </li>
            ))}
          </ul>

          {/* Twelve equal columns of square cells that grow with the card. */}
          <div
            className="grid min-w-0 grid-flow-col grid-cols-12 grid-rows-7 gap-1 sm:gap-1.5"
            role="img"
            aria-label={`Activity heatmap: ${String(total)} applications added across ${String(activeDays)} active days in the last 12 weeks`}
          >
            {cells.map((cell) => (
              <span
                key={cell.key}
                data-testid="heatmap-cell"
                data-count={cell.count}
                title={`${formatDate(cell.key)}: ${String(cell.count)} added`}
                className={cn(
                  'aspect-square rounded-chip ring-1 ring-inset ring-border/60',
                  HEAT_LEVEL_CLASSES[heatLevel(cell.count, busiest)],
                )}
              />
            ))}
          </div>

          {/* Spans the label column to keep its place at the card's edge, but is
              sized as if empty: otherwise "Less … More" (about 110px) would set
              the auto label column's width, shrinking the grid to 179px at 375. */}
          <div className="col-span-2 flex items-center gap-1.5 text-[0.625rem] text-content-subtle [contain:inline-size]">
            <span>Less</span>
            {HEAT_LEVEL_CLASSES.map((level) => (
              <span key={level} className={cn('h-2.5 w-2.5 rounded-chip', level)} />
            ))}
            <span>More</span>
          </div>

          <div className={SIDE_COLUMN}>
            <FollowThrough cells={cells} />
            <WeeklyPace cells={cells} target={weeklyGoal} />
          </div>
        </div>
      )}
    </Card>
  );
}
