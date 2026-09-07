import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { ChartDataSummary } from '@/features/dashboard/charts/ChartDataSummary';
import { ChartFrame } from '@/features/dashboard/charts/ChartFrame';
import { useChartPalette } from '@/features/dashboard/charts/chartTheme';
import { verticalOptions } from '@/features/dashboard/charts/chartOptions';
import '@/features/dashboard/charts/chartRegistry';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/formatters';
import { TIMELINE_GRANULARITIES, type Timeline, type TimelineGranularity } from '@/types/analytics';

interface TimelineChartProps {
  timeline: Timeline | undefined;
  granularity: TimelineGranularity;
  onGranularityChange: (granularity: TimelineGranularity) => void;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

const GRANULARITY_LABELS: Record<TimelineGranularity, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
};

/** Applications created and status changes over time, SPEC section 6 chart 1. */
export function TimelineChart({
  timeline,
  granularity,
  onGranularityChange,
  isLoading,
  error,
  onRetry,
}: TimelineChartProps): JSX.Element {
  const palette = useChartPalette();
  // Memoised because the `?? []` fallback would otherwise be a fresh array on
  // every render, rebuilding the chart data and pushing a pointless update
  // into Chart.js each time the page re-renders.
  const points = useMemo(() => timeline?.points ?? [], [timeline]);

  const data = useMemo(
    () => ({
      labels: points.map((point) => formatDate(point.bucket)),
      datasets: [
        {
          label: 'Applications added',
          data: points.map((point) => point.created),
          borderColor: palette.color('color-primary'),
          backgroundColor: palette.color('color-primary', 0.16),
          pointBackgroundColor: palette.color('color-primary'),
          pointBorderColor: palette.color('color-surface'),
          pointRadius: 3,
          pointHoverRadius: 5,
          borderWidth: 2,
          tension: 0.35,
          fill: true,
        },
        {
          label: 'Status changes',
          data: points.map((point) => point.statusChanges),
          borderColor: palette.color('color-info'),
          backgroundColor: palette.color('color-info', 0.12),
          pointBackgroundColor: palette.color('color-info'),
          pointBorderColor: palette.color('color-surface'),
          pointRadius: 3,
          pointHoverRadius: 5,
          borderWidth: 2,
          tension: 0.35,
          fill: true,
        },
      ],
    }),
    [points, palette],
  );

  const options = useMemo(() => verticalOptions(palette), [palette]);

  return (
    <ChartFrame
      title="Applications over time"
      description="Added and moved, in your timezone"
      controls={
        <div
          className="inline-flex rounded-control border border-border p-0.5"
          role="group"
          aria-label="Timeline grouping"
        >
          {TIMELINE_GRANULARITIES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === granularity}
              onClick={() => {
                onGranularityChange(option);
              }}
              className={cn(
                'rounded-[0.4rem] px-2.5 py-1 text-xs font-medium transition-colors',
                option === granularity
                  ? 'bg-primary-fill text-primary-fill-fg'
                  : 'text-content-muted hover:bg-surface-muted',
              )}
            >
              {GRANULARITY_LABELS[option]}
            </button>
          ))}
        </div>
      }
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      isEmpty={points.length === 0}
      emptyMessage="No activity in this range yet."
    >
      <>
        <div className="h-full" data-testid="timeline-chart">
          {/* react-chartjs-2 puts `role="img"` on the canvas, and a nameless
              `role="img"` is a serious axe violation. Naming it here would be the
              wrong fix: the canvas has no content assistive technology can read,
              and the numbers are already carried by the `sr-only` table below, so
              an `aria-label` would only announce the same chart twice. Hiding the
              canvas leaves the table as the single text alternative. */}
          <Line data={data} options={options} aria-hidden />
        </div>
        <ChartDataSummary
          caption={`Applications added per ${granularity}`}
          valueHeading="Added, status changes"
          rows={points.map((point) => ({
            label: formatDate(point.bucket),
            value: `${String(point.created)} added, ${String(point.statusChanges)} status changes`,
          }))}
        />
      </>
    </ChartFrame>
  );
}
