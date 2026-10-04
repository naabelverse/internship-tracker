import { useMemo } from 'react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/formatters';
import { ActiveDaysStat } from '@/features/dashboard/ActiveDaysStat';
import { FiguresTip, HeatmapTip, PaceTip } from '@/features/dashboard/ActivityTips';
import { FollowThrough } from '@/features/dashboard/FollowThrough';
import { WeeklyPace } from '@/features/dashboard/WeeklyPace';
import { HEAT_LEVEL_CLASSES, heatLevel } from '@/features/dashboard/heatLevels';
import { countActiveDays } from '@/features/dashboard/followThroughStats';
import { buildCells, localDayKey } from '@/features/dashboard/heatmapCells';
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
 * The subtitle in a phone length and a full length, the Dashboard header's
 * `Lede` pattern, so it stays one line. The full line measures 405px and the
 * short one 210px; the card's content box is 254px at 320 wide and 324px at
 * 390, then 662px or more from 768 up. The switch is at a 26rem card, on the
 * same container query as `LAYOUT`, because the card's width does not follow
 * the viewport's. `display: none` takes the hidden one out of the
 * accessibility tree, so a screen reader hears only the one on screen.
 */
const SUBTITLE_SHORT = '[@container_(min-width:26rem)]:hidden';
const SUBTITLE_FULL = 'hidden [@container_(min-width:26rem)]:inline';

/**
 * Weekday labels, the grid, and the side column (follow-through over weekly
 * pace), as one CSS grid whose second column is the heatmap's: up to
 * `max-w-md` (28rem), which puts a cell at about 32px and the grid at 259px
 * tall, level with the 256px plots in the chart cards above.
 *
 * One rule. Narrow, the side column takes the row under the legend in that
 * same column, so each pace bar sits directly under its week. From a 40rem
 * card it moves beside the grid, behind a 1rem spacer track, and takes all the
 * width left over, never less than 15rem. The grid's track reaches its 28rem
 * cap before the side column grows past that floor: a 662px card (a 1024
 * window with the sidebar) has a 362px grid and a 240px column, and a 1174px
 * one (1536 and up, where the page stops widening) a 448px grid and a 674px
 * column, so nothing is left empty to the right at any width. It is a container
 * query, not a viewport breakpoint, because the card's width is not monotonic
 * in the viewport: the sidebar arriving at `lg` takes 256px, so a 1024 window
 * has a 662px card while a 1023 one, with the sidebar in a drawer, has 933.
 */
const LAYOUT =
  'mt-4 grid grid-cols-[auto_minmax(0,28rem)] justify-start gap-x-2 gap-y-4 [@container_(min-width:40rem)]:grid-cols-[auto_minmax(0,28rem)_1rem_minmax(15rem,1fr)]';

/**
 * Follow-through over weekly pace, stacked under the legend in the grid's
 * column, or beside the grid and legend, spanning both rows. Beside, the
 * column is exactly as tall as those rows and the pace plot takes whatever
 * height the figures leave; see `PACE_PLOT`.
 */
const SIDE_COLUMN =
  'col-start-2 row-start-3 flex flex-col gap-4 [@container_(min-width:40rem)]:col-start-4 [@container_(min-width:40rem)]:row-span-2 [@container_(min-width:40rem)]:row-start-1';

/**
 * The pace plot: 80px under the grid. Beside it, the plot starts at 48px and
 * grows into the column's spare height, so the column never sets the card's
 * height. Its floor there, with "of N days" under Active days and the pace
 * summary wrapped to two lines in a 240px column, is 215px; the grid and legend
 * rows are 227px at a 40rem card and 290px once the grid reaches its cap, where
 * the plot is 139px. That is why the rule is at 40rem: at 38rem the rows are
 * 208px and the column would push the card 7px taller.
 */
const PACE_PLOT = 'h-20 [@container_(min-width:40rem)]:h-12';

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
  const activeDays = countActiveDays(cells, localDayKey(new Date(), timeZone));
  const addedDays = cells.filter((cell) => cell.count > 0).length;

  return (
    // The card is the query container, so the layout follows the room the card
    // actually has rather than the window's width.
    <Card as="section" className="[container-type:inline-size]">
      <div>
        <h2 className="panel-title">Activity</h2>
        <p className="mt-0.5 text-xs text-content-subtle">
          <span className={SUBTITLE_SHORT}>
            {weeklyGoal > 0 ? 'Last 12 weeks, against your weekly goal' : 'Last 12 weeks'}
          </span>
          <span className={SUBTITLE_FULL}>
            {weeklyGoal > 0
              ? 'Your activity over the last 12 weeks, and how it compares to your weekly goal.'
              : 'Your activity over the last 12 weeks.'}
          </span>
        </p>
      </div>

      {isLoading ? (
        // The loaded layout's own tracks, with the grid's 12:7 shape, so the
        // card does not jump when it loads.
        <div className={LAYOUT}>
          <span className="w-5" aria-hidden="true" />
          <Skeleton className="aspect-[12/7] w-full" label="Loading activity" />
          <span className="col-span-2 row-start-2 h-4" aria-hidden="true" />
          <div className={SIDE_COLUMN} aria-hidden="true">
            {/* The figures are 87px. The pace panel is 128px under the grid
                and fills the rest of the column beside it. */}
            <div className="skeleton h-[5.5rem]" />
            <div className="skeleton h-32 flex-auto [@container_(min-width:40rem)]:h-auto" />
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
            aria-label={`Activity heatmap: ${String(total)} applications added across ${String(addedDays)} days in the last 12 weeks`}
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

          {/* Pinned to the row under the grid rather than auto-placed, so no
              track layout can move it beside the grid. Spans the label column
              to keep its place at the card's edge, but is sized as if empty:
              otherwise "Less … More" and its tip (about 134px) would set the auto label
              column's width, shrinking the grid to 179px at 375. */}
          <div className="col-span-2 row-start-2 flex items-center gap-1.5 text-[0.625rem] text-content-subtle [contain:inline-size]">
            <span>Less</span>
            {HEAT_LEVEL_CLASSES.map((level) => (
              <span key={level} className={cn('h-2.5 w-2.5 rounded-chip', level)} />
            ))}
            <span>More</span>
            <div className="ml-1 flex">
              <HeatmapTip />
            </div>
          </div>

          <div className={SIDE_COLUMN}>
            <FollowThrough cells={cells} info={<FiguresTip />}>
              <ActiveDaysStat activeDays={activeDays} />
            </FollowThrough>
            <WeeklyPace
              cells={cells}
              target={weeklyGoal}
              plotClassName={PACE_PLOT}
              info={<PaceTip goal={weeklyGoal} />}
            />
          </div>
        </div>
      )}
    </Card>
  );
}
