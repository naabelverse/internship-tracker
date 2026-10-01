import { useChartPalette } from '@/features/dashboard/charts/chartTheme';

interface WeeklyGoalRingProps {
  completed: number;
  target: number;
}

const RADIUS = 20;
const STROKE_WIDTH = 5;
const TRACK_ALPHA = 0.2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The share of the goal met: 1 is met, and past it keeps counting.
 *
 * Worked out from the counts rather than the server's `percentage`, which is
 * rounded to one decimal place: 1 of 3 arrives as 33.3 and would draw 119.88°.
 * A goal of 0 is allowed and reads as 0, as the server's figure does.
 */
export function goalFraction(completed: number, target: number): number {
  return target <= 0 ? 0 : completed / target;
}

/**
 * The weekly goal ring from SPEC section 6.
 *
 * Hand-drawn SVG rather than a sixth Chart.js instance: a single-value ring
 * needs no scales, no tooltip and no legend, and one arc costs a few bytes
 * against a whole doughnut controller. Colours still come from the same token
 * palette the charts read, so it re-themes with them.
 *
 * The fill is `primary`, the colour the timeline already uses for applications,
 * and the track is the same colour at 20%, as the timeline's area fill is. The
 * track used to be `surface-muted`, which sits at 1.14:1 on the card (1.11:1
 * dark), so the remainder vanished and the fill read as a stray stroke with
 * nothing to measure it against. The tint is 1.54:1 on the card (1.72:1 dark),
 * which reads as the rest of the circle without competing with the fill, and
 * the fill clears it at 11.4:1 (6.7:1 dark). `border-strong` was tried first:
 * 2.15:1 in light, where the grey remainder outweighed the progress.
 *
 * The ends are butt-capped so the arc covers exactly its share of the circle.
 * Round caps reach half the stroke width past each end, about 7° here, which
 * drew 1 of 5 as 86° instead of 72° and started it before twelve o'clock.
 */
export function WeeklyGoalRing({ completed, target }: WeeklyGoalRingProps): JSX.Element {
  const palette = useChartPalette();
  const fraction = goalFraction(completed, target);
  const filled = Math.min(fraction, 1);

  return (
    <svg
      viewBox="0 0 48 48"
      className="h-12 w-12 -rotate-90 sm:h-14 sm:w-14"
      role="img"
      aria-label={`${String(completed)} of ${String(target)} applications this week, ${String(Math.round(fraction * 100))} percent of the goal`}
    >
      <circle
        cx="24"
        cy="24"
        r={RADIUS}
        fill="none"
        strokeWidth={STROKE_WIDTH}
        stroke={palette.color('color-primary', TRACK_ALPHA)}
      />
      <circle
        cx="24"
        cy="24"
        r={RADIUS}
        fill="none"
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="butt"
        stroke={palette.color(filled >= 1 ? 'color-success' : 'color-primary')}
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - filled)}
        className="transition-[stroke-dashoffset] duration-data"
      />
    </svg>
  );
}
