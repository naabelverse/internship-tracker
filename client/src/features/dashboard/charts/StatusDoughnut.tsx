import { useMemo } from 'react';
import { Doughnut } from 'react-chartjs-2';
import { ChartDataSummary } from '@/features/dashboard/charts/ChartDataSummary';
import { ChartFrame } from '@/features/dashboard/charts/ChartFrame';
import { doughnutOptions } from '@/features/dashboard/charts/chartOptions';
import { useChartPalette } from '@/features/dashboard/charts/chartTheme';
import '@/features/dashboard/charts/chartRegistry';
import { STATUS_CONFIG } from '@/lib/statusConfig';
import type { StatusBreakdownEntry } from '@/types/analytics';

interface StatusDoughnutProps {
  breakdown: StatusBreakdownEntry[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/**
 * Status breakdown with the custom legend and centre total SPEC section 6 asks
 * for. Empty statuses are dropped from the drawn slices but kept in the legend,
 * so the set of statuses a reader sees does not change as data arrives.
 */
export function StatusDoughnut({
  breakdown,
  isLoading,
  error,
  onRetry,
}: StatusDoughnutProps): JSX.Element {
  const palette = useChartPalette();
  const entries = breakdown ?? [];
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  const drawn = entries.filter((entry) => entry.count > 0);

  const data = useMemo(
    () => ({
      labels: drawn.map((entry) => STATUS_CONFIG[entry.status].label),
      datasets: [
        {
          data: drawn.map((entry) => entry.count),
          backgroundColor: drawn.map((entry) => palette.statusColor(entry.status)),
          borderColor: palette.color('color-surface'),
          borderWidth: 2,
          hoverOffset: 6,
        },
      ],
    }),
    [drawn, palette],
  );

  const options = useMemo(() => doughnutOptions(palette), [palette]);

  return (
    <ChartFrame
      title="Status breakdown"
      description="Where everything stands right now"
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      isEmpty={total === 0}
      emptyMessage="Nothing to break down yet."
      heightClass="h-auto"
    >
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <div className="relative h-48 w-48 shrink-0" data-testid="status-doughnut">
          {/* react-chartjs-2 puts `role="img"` on the canvas, and a nameless
              `role="img"` is a serious axe violation. Naming it here would be the
              wrong fix: the canvas has no content assistive technology can read,
              and the numbers are already carried by the `sr-only` table below, so
              an `aria-label` would only announce the same chart twice. Hiding the
              canvas leaves the table as the single text alternative. */}
          <Doughnut data={data} options={options} aria-hidden />
          {/* The centre total is markup rather than a canvas plugin, so it is
              real text a screen reader and a text zoom both handle. */}
          <div
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
            aria-hidden="true"
          >
            <span className="text-2xl font-semibold text-content">{total}</span>
            <span className="text-xs text-content-subtle">total</span>
          </div>
        </div>

        <ul className="grid w-full grid-cols-2 gap-x-4 gap-y-1.5">
          {entries.map((entry) => (
            <li key={entry.status} className="flex items-center gap-2 text-xs">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: palette.statusColor(entry.status) }}
                aria-hidden="true"
              />
              <span className="truncate text-content-muted">
                {STATUS_CONFIG[entry.status].label}
              </span>
              <span className="ml-auto font-medium text-content">{entry.count}</span>
            </li>
          ))}
        </ul>
      </div>

      <ChartDataSummary
        caption={`Status breakdown of ${String(total)} applications`}
        valueHeading="Applications"
        rows={entries.map((entry) => ({
          label: STATUS_CONFIG[entry.status].label,
          value: String(entry.count),
        }))}
      />
    </ChartFrame>
  );
}
