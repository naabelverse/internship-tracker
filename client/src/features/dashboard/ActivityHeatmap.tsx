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
import { countActiveDays, summarizeFollowThrough } from '@/features/dashboard/followThroughStats';
import { buildCells, dayActivity, localDayKey, type Cell } from '@/features/dashboard/heatmapCells';
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
 *
 * Rows: the heatmap's title, the grid, the legend, and (narrow) the side
 * column. Every item is placed by row and column, because with the title
 * filling the first two tracks of row 1, auto-placement would put the weekday
 * labels in the spacer track beside it. The row gap is 8px, title to grid as
 * in the side column's sections; the legend and the stacked side column add
 * 8px of margin to keep the 16px they had below the grid.
 */
const LAYOUT =
  'mt-4 grid grid-cols-[auto_minmax(0,28rem)] justify-start gap-x-2 gap-y-2 [@container_(min-width:40rem)]:grid-cols-[auto_minmax(0,28rem)_1rem_minmax(15rem,1fr)]';

/**
 * "Daily activity" and its tip, over the labels and grid, in the side
 * sections' title style. Beside the grid it is level with "Follow-through".
 * Sized as if empty, like the legend, so its text cannot widen the auto label
 * column.
 */
const HEATMAP_TITLE = 'col-span-2 row-start-1 flex items-center gap-1.5 [contain:inline-size]';

/**
 * Follow-through over weekly pace, stacked under the legend in the grid's
 * column, or beside the title, grid and legend, spanning all three rows.
 * Beside, the column is exactly as tall as those rows and the pace plot takes
 * whatever height the figures leave; see `PACE_PLOT`.
 */
const SIDE_COLUMN =
  'col-start-2 row-start-4 mt-2 flex flex-col gap-2 [@container_(min-width:40rem)]:col-start-4 [@container_(min-width:40rem)]:row-span-3 [@container_(min-width:40rem)]:row-start-1 [@container_(min-width:40rem)]:mt-0';

/**
 * A hairline between the figures and Weekly pace, 8px either side: the app's
 * `border-border` rule between two regions of one surface, as in a modal's
 * footer or a settings section's. Inside the figures the gaps are 8px under
 * the title and 4px under the row, so the ratio line reads as the figures'
 * caption rather than a heading for the panel below. A rule costs 1px over
 * the 16px gap it replaces; a gap wide enough to separate on its own (24px)
 * would cost 8px more of the pace plot.
 */
const PACE_SECTION = 'border-t border-border pt-2';

/**
 * The pace plot: 80px under the grid. Beside it, the plot starts at 36px and
 * grows into the column's spare height, so the column never sets the card's
 * height. Its floor there, with "of N days" under Active days and the pace
 * summary wrapped to two lines in a 240px column, is 224px. The column spans
 * the heatmap's title row too, so the rows it fills are 24px taller than the
 * grid and legend alone: 251px at a 40rem card and 314px once the grid reaches
 * its cap, where the plot is 142px. A 1024 window's card is 662px, or 647px
 * beside a classic scrollbar, where the plot is 75px and 67px. The floor went
 * from 48px to 36px when the figures took a title and the rule above Weekly
 * pace; the title row has since given that back and more. The beside rule
 * stays at 40rem, where PR #75 measured it; the title row changed no rule.
 */
const PACE_PLOT = 'h-20 [@container_(min-width:40rem)]:h-9';

/** A square's tooltip: the date, then both counts that shade it. */
function cellTitle(cell: Cell): string {
  const updates = `${String(cell.updates)} status ${cell.updates === 1 ? 'update' : 'updates'}`;

  return `${formatDate(cell.key)}: ${String(cell.count)} added, ${updates}`;
}

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
  const busiest = cells.reduce((max, cell) => Math.max(max, dayActivity(cell)), 0);
  const totals = summarizeFollowThrough(cells);
  const activeDays = countActiveDays(cells, localDayKey(new Date(), timeZone));

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
          <span className="col-span-2 row-start-1 h-4" aria-hidden="true" />
          <span className="col-start-1 row-start-2 w-5" aria-hidden="true" />
          <Skeleton
            className="col-start-2 row-start-2 aspect-[12/7] w-full"
            label="Loading activity"
          />
          <span className="col-span-2 row-start-3 mt-2 h-4" aria-hidden="true" />
          <div className={SIDE_COLUMN} aria-hidden="true">
            {/* The titled figures are 107px. The pace panel is 128px inside
                its rule under the grid and fills the rest of the column
                beside it. */}
            <div className="skeleton h-[6.75rem]" />
            <div className={cn(PACE_SECTION, 'flex flex-auto flex-col')}>
              <div className="skeleton h-32 flex-auto [@container_(min-width:40rem)]:h-auto" />
            </div>
          </div>
        </div>
      ) : (
        <div className={LAYOUT}>
          <div className={HEATMAP_TITLE}>
            <h3 className="text-xs text-content-subtle">Daily activity</h3>
            <HeatmapTip />
          </div>

          {/* Seven rows on the same gap as the cells, stretched to the grid's
              height, so each label stays centred on its row at any cell size. */}
          <ul
            className="col-start-1 row-start-2 grid grid-rows-7 gap-1 text-[0.625rem] text-content-subtle sm:gap-1.5"
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
            className="col-start-2 row-start-2 grid min-w-0 grid-flow-col grid-cols-12 grid-rows-7 gap-1 sm:gap-1.5"
            role="img"
            aria-label={`Activity heatmap: ${String(totals.added)} applications added and ${String(totals.updates)} status updates, on ${String(activeDays.active)} active days in the last 12 weeks`}
          >
            {cells.map((cell) => (
              <span
                key={cell.key}
                data-testid="heatmap-cell"
                data-count={cell.count}
                data-updates={cell.updates}
                title={cellTitle(cell)}
                className={cn(
                  'aspect-square rounded-chip ring-1 ring-inset ring-border/60',
                  HEAT_LEVEL_CLASSES[heatLevel(dayActivity(cell), busiest)],
                )}
              />
            ))}
          </div>

          {/* Pinned to the row under the grid rather than auto-placed, so no
              track layout can move it beside the grid. Spans the label column
              to keep its place at the card's edge, but is sized as if empty:
              otherwise "Less … More" (about 110px) would set the auto label
              column's width, shrinking the grid to 179px at 375. */}
          <div className="col-span-2 row-start-3 mt-2 flex items-center gap-1.5 text-[0.625rem] text-content-subtle [contain:inline-size]">
            <span>Less</span>
            {HEAT_LEVEL_CLASSES.map((level) => (
              <span key={level} className={cn('h-2.5 w-2.5 rounded-chip', level)} />
            ))}
            <span>More</span>
          </div>

          <div className={SIDE_COLUMN}>
            <FollowThrough cells={cells} info={<FiguresTip />}>
              <ActiveDaysStat activeDays={activeDays} />
            </FollowThrough>
            <WeeklyPace
              cells={cells}
              target={weeklyGoal}
              plotClassName={PACE_PLOT}
              className={PACE_SECTION}
              info={<PaceTip goal={weeklyGoal} />}
            />
          </div>
        </div>
      )}
    </Card>
  );
}
