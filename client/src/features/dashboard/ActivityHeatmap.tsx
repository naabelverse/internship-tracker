import { useMemo } from 'react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/formatters';
import type { TimelinePoint } from '@/types/analytics';

interface ActivityHeatmapProps {
  /** Daily buckets; anything coarser cannot fill a per-day grid. */
  points: TimelinePoint[] | undefined;
  isLoading: boolean;
}

const WEEKS = 12;
const DAYS_PER_WEEK = 7;
const MS_PER_DAY = 86_400_000;

/** Monday first, matching the week the analytics aggregation buckets on. */
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const LEVEL_CLASSES = ['bg-heat-0', 'bg-heat-1', 'bg-heat-2', 'bg-heat-3', 'bg-heat-4'] as const;

/** Four filled levels, so a busy day is distinguishable from a merely active one. */
function levelFor(count: number, busiest: number): number {
  if (count === 0) return 0;
  if (busiest <= 1) return LEVEL_CLASSES.length - 1;

  const share = count / busiest;
  if (share > 0.75) return 4;
  if (share > 0.5) return 3;
  if (share > 0.25) return 2;

  return 1;
}

interface Cell {
  key: string;
  date: Date;
  count: number;
}

/** The last twelve weeks of days, ending on today, Monday-aligned. */
function buildCells(points: TimelinePoint[], today: Date): Cell[] {
  const counts = new Map<string, number>();

  for (const point of points) {
    const key = point.bucket.slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + point.created);
  }

  // Monday of the current week, then back eleven more weeks, so the grid always
  // ends on a whole week and today never lands mid-column.
  const mondayOffset = (today.getDay() + 6) % DAYS_PER_WEEK;
  const start = new Date(
    today.getTime() - (mondayOffset + (WEEKS - 1) * DAYS_PER_WEEK) * MS_PER_DAY,
  );

  return Array.from({ length: WEEKS * DAYS_PER_WEEK }, (_unused, index) => {
    const date = new Date(start.getTime() + index * MS_PER_DAY);
    const key = date.toISOString().slice(0, 10);

    return { key, date, count: counts.get(key) ?? 0 };
  });
}

/**
 * Activity per day over the last twelve weeks.
 *
 * CSS grid rather than Chart.js, which SPEC section 6 calls for explicitly: 84
 * coloured squares need no canvas, and as real elements each one can carry its
 * own title and its own row in the table below.
 */
export function ActivityHeatmap({ points, isLoading }: ActivityHeatmapProps): JSX.Element {
  const cells = useMemo(() => buildCells(points ?? [], new Date()), [points]);
  const busiest = cells.reduce((max, cell) => Math.max(max, cell.count), 0);
  const total = cells.reduce((sum, cell) => sum + cell.count, 0);
  const activeDays = cells.filter((cell) => cell.count > 0).length;

  return (
    <Card as="section">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="panel-title">Activity</h2>
        <p className="text-xs text-content-subtle">Last 12 weeks</p>
      </div>

      {isLoading ? (
        // The grid's own 12:7 shape and cap, beside the label column's 28px and
        // above the legend's, so the card does not jump when it loads.
        <Skeleton className="mb-7 ml-7 mt-4 aspect-[12/7] max-w-md" label="Loading activity" />
      ) : (
        <>
          <div className="mt-4 flex gap-2">
            {/* Seven rows on the same gap as the cells, stretched to the grid's
                height, so each label stays centred on its row at any cell size. */}
            <ul
              className="grid shrink-0 grid-rows-7 gap-1 text-[0.625rem] text-content-subtle sm:gap-1.5"
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

            {/* Twelve equal columns of square cells that grow with the card, up
                to `max-w-md`: 448px puts a cell at about 32px and the grid at
                259px tall, level with the 256px plots in the chart cards above. */}
            <div
              className="grid min-w-0 max-w-md flex-1 grid-flow-col grid-cols-12 grid-rows-7 gap-1 sm:gap-1.5"
              role="img"
              aria-label={`Activity heatmap: ${String(total)} applications added across ${String(activeDays)} active days in the last 12 weeks`}
            >
              {cells.map((cell) => (
                <span
                  key={cell.key}
                  data-testid="heatmap-cell"
                  data-count={cell.count}
                  title={`${formatDate(cell.date.toISOString())}: ${String(cell.count)} added`}
                  className={cn(
                    'aspect-square rounded-chip ring-1 ring-inset ring-border/60',
                    LEVEL_CLASSES[levelFor(cell.count, busiest)],
                  )}
                />
              ))}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-1.5 text-[0.625rem] text-content-subtle">
            <span>Less</span>
            {LEVEL_CLASSES.map((level) => (
              <span key={level} className={cn('h-2.5 w-2.5 rounded-chip', level)} />
            ))}
            <span>More</span>
          </div>
        </>
      )}
    </Card>
  );
}
