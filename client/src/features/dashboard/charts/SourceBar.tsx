import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { ChartDataSummary } from '@/features/dashboard/charts/ChartDataSummary';
import { ChartFrame } from '@/features/dashboard/charts/ChartFrame';
import { verticalOptions } from '@/features/dashboard/charts/chartOptions';
import { useChartPalette } from '@/features/dashboard/charts/chartTheme';
import '@/features/dashboard/charts/chartRegistry';
import { SOURCE_LABELS } from '@/lib/statusConfig';
import type { SourceEntry } from '@/types/analytics';
import type { Source } from '@/types/application';

interface SourceBarProps {
  sources: SourceEntry[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Rows the server could not attribute come back as `unspecified`. */
function sourceLabel(source: string): string {
  return SOURCE_LABELS[source as Source] ?? 'Unspecified';
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
      labels: entries.map((entry) => sourceLabel(entry.source)),
      datasets: [
        {
          label: 'Applications',
          data: entries.map((entry) => entry.count),
          backgroundColor: entries.map(
            (_entry, index) => palette.series[index % palette.series.length],
          ),
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
          <Bar data={data} options={options} />
        </div>
        <ChartDataSummary
          caption="Applications by source"
          valueHeading="Applications"
          rows={entries.map((entry) => ({
            label: sourceLabel(entry.source),
            value: String(entry.count),
          }))}
        />
      </>
    </ChartFrame>
  );
}
