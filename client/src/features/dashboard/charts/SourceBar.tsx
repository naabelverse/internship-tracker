import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { ChartDataSummary } from '@/features/dashboard/charts/ChartDataSummary';
import { ChartFrame } from '@/features/dashboard/charts/ChartFrame';
import { verticalOptions } from '@/features/dashboard/charts/chartOptions';
import { useChartPalette } from '@/features/dashboard/charts/chartTheme';
import '@/features/dashboard/charts/chartRegistry';
import { sourceLabel } from '@/lib/statusConfig';
import type { SourceEntry } from '@/types/analytics';

interface SourceBarProps {
  sources: SourceEntry[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/**
 * Rows the server could not attribute come back as `unspecified`. Anything else
 * off the list is a retired value, shown as stored rather than folded into
 * "Unspecified", which would claim the user never recorded one.
 */
function barLabel(source: string): string {
  return source === 'unspecified' ? 'Unspecified' : sourceLabel(source);
}

/** Applications by source, SPEC section 6 chart 3. */
export function SourceBar({ sources, isLoading, error, onRetry }: SourceBarProps): JSX.Element {
  const palette = useChartPalette();
  // Memoised because the `?? []` fallback would otherwise be a fresh array
  // on every render, which would rebuild the chart data and push a pointless
  // update into Chart.js each time the page re-renders.
  const entries = useMemo(() => sources ?? [], [sources]);

  const data = useMemo(
    () => ({
      labels: entries.map((entry) => barLabel(entry.source)),
      datasets: [
        {
          label: 'Applications',
          data: entries.map((entry) => entry.count),
          // One colour, as on the top-companies chart. Each bar is named on the
          // axis, so a colour per bar carried nothing, and with more sources than
          // series tokens it would have had to repeat one.
          backgroundColor: palette.color('color-chart-1', 0.85),
          borderRadius: 6,
          maxBarThickness: 44,
        },
      ],
    }),
    [entries, palette],
  );

  const options = useMemo(() => verticalOptions(palette), [palette]);

  return (
    <ChartFrame
      title="By source"
      description="Where your applications come from"
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      isEmpty={entries.length === 0}
      emptyMessage="No sources recorded yet."
    >
      <>
        <div className="h-full" data-testid="source-bar">
          {/* react-chartjs-2 puts `role="img"` on the canvas, and a nameless
              `role="img"` is a serious axe violation. Naming it here would be the
              wrong fix: the canvas has no content assistive technology can read,
              and the numbers are already carried by the `sr-only` table below, so
              an `aria-label` would only announce the same chart twice. Hiding the
              canvas leaves the table as the single text alternative. */}
          <Bar data={data} options={options} aria-hidden />
        </div>
        <ChartDataSummary
          caption="Applications by source"
          valueHeading="Applications"
          rows={entries.map((entry) => ({
            label: barLabel(entry.source),
            value: String(entry.count),
          }))}
        />
      </>
    </ChartFrame>
  );
}
