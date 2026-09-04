import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { ChartDataSummary } from '@/features/dashboard/charts/ChartDataSummary';
import { ChartFrame } from '@/features/dashboard/charts/ChartFrame';
import { horizontalOptions } from '@/features/dashboard/charts/chartOptions';
import { useChartPalette } from '@/features/dashboard/charts/chartTheme';
import '@/features/dashboard/charts/chartRegistry';
import type { CompanyEntry } from '@/types/analytics';

interface TopCompaniesBarProps {
  companies: CompanyEntry[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/** The ten companies applied to most often, SPEC section 6 chart 5. */
export function TopCompaniesBar({
  companies,
  isLoading,
  error,
  onRetry,
}: TopCompaniesBarProps): JSX.Element {
  const palette = useChartPalette();
  // Memoised because the `?? []` fallback would otherwise be a fresh array
  // on every render, which would rebuild the chart data and push a pointless
  // update into Chart.js each time the page re-renders.
  const entries = useMemo(() => companies ?? [], [companies]);

  const data = useMemo(
    () => ({
      labels: entries.map((entry) => entry.company),
      datasets: [
        {
          label: 'Applications',
          data: entries.map((entry) => entry.count),
          backgroundColor: palette.color('color-chart-1', 0.85),
          hoverBackgroundColor: palette.color('color-chart-1'),
          borderRadius: 6,
          maxBarThickness: 22,
        },
      ],
    }),
    [entries, palette],
  );

  const options = useMemo(() => horizontalOptions(palette), [palette]);

  return (
    <ChartFrame
      title="Top companies"
      description="Where you have applied most"
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      isEmpty={entries.length === 0}
      emptyMessage="No companies to rank yet."
      heightClass="h-72"
    >
      <>
        <div className="h-full" data-testid="top-companies-bar">
          <Bar data={data} options={options} />
        </div>
        <ChartDataSummary
          caption="Companies applied to most often"
          valueHeading="Applications"
          rows={entries.map((entry) => ({ label: entry.company, value: String(entry.count) }))}
        />
      </>
    </ChartFrame>
  );
}
