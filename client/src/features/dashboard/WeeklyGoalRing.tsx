import { useChartPalette } from '@/features/dashboard/charts/chartTheme';

interface WeeklyGoalRingProps {
  completed: number;
  target: number;
  percentage: number;
}

const RADIUS = 20;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The weekly goal ring from SPEC section 6.
 *
 * Hand-drawn SVG rather than a sixth Chart.js instance: a single-value ring
 * needs no scales, no tooltip and no legend, and one arc costs a few bytes
 * against a whole doughnut controller. Colours still come from the same token
 * palette the charts read, so it re-themes with them.
 */
export function WeeklyGoalRing({
  completed,
  target,
  percentage,
}: WeeklyGoalRingProps): JSX.Element {
  const palette = useChartPalette();
  const filled = Math.min(percentage, 100) / 100;

  return (
    <svg
      viewBox="0 0 48 48"
      className="h-12 w-12 shrink-0 -rotate-90"
      role="img"
      aria-label={`${String(completed)} of ${String(target)} applications this week, ${String(Math.round(percentage))} percent of the goal`}
    >
      <circle
        cx="24"
        cy="24"
        r={RADIUS}
        fill="none"
        strokeWidth="5"
        stroke={palette.color('color-surface-muted')}
      />
      <circle
        cx="24"
        cy="24"
        r={RADIUS}
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        stroke={palette.color(percentage >= 100 ? 'color-success' : 'color-primary')}
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - filled)}
        className="transition-[stroke-dashoffset] duration-data"
      />
    </svg>
  );
}
