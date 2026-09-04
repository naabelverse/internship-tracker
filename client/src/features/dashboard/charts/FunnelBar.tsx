import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import type { TooltipItem } from 'chart.js';
import { ChartDataSummary } from '@/features/dashboard/charts/ChartDataSummary';
import { ChartFrame } from '@/features/dashboard/charts/ChartFrame';
import { horizontalOptions } from '@/features/dashboard/charts/chartOptions';
import { useChartPalette } from '@/features/dashboard/charts/chartTheme';
import '@/features/dashboard/charts/chartRegistry';
import type { FunnelStage } from '@/types/analytics';

interface FunnelBarProps {
  stages: FunnelStage[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

const STAGE_LABELS: Record<string, string> = {
  applied: 'Applied',
  assessment: 'Assessment',
  interview: 'Interview',
  offer: 'Offer',
};

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

function percent(value: number): string {
  return String(value) + '%';
}

/** The conversion funnel, SPEC section 6 chart 4. */
export function FunnelBar({ stages, isLoading, error, onRetry }: FunnelBarProps): JSX.Element {
  const palette = useChartPalette();
  // Memoised because the `?? []` fallback would otherwise be a fresh array
  // on every render, which would rebuild the chart data and push a pointless
  // update into Chart.js each time the page re-renders.
  const entries = useMemo(() => stages ?? [], [stages]);

  const data = useMemo(
    () => ({
      labels: entries.map((entry) => stageLabel(entry.stage)),
      datasets: [
        {
          label: 'Reached',
          data: entries.map((entry) => entry.count),
          backgroundColor: entries.map(
            (_entry, index) => palette.series[index % palette.series.length],
          ),
          borderRadius: 6,
          maxBarThickness: 32,
        },
      ],
    }),
    [entries, palette],
  );

  const options = useMemo(() => {
    const base = horizontalOptions(palette);

    return {
      ...base,
      plugins: {
        ...base.plugins,
        tooltip: {
          ...base.plugins?.tooltip,
          callbacks: {
            // The percentages are the point of a funnel, so they belong in the
            // tooltip rather than only in the summary table beside it.
            label: (item: TooltipItem<'bar'>) => {
              const stage = entries[item.dataIndex];
              const fromApplied = percent(stage.conversionFromApplied);
              const fromPrevious = percent(stage.conversionFromPrevious);

              return (
                String(stage.count) +
                ' reached, ' +
                fromApplied +
                ' of applied, ' +
                fromPrevious +
                ' from the stage before'
              );
            },
          },
        },
      },
    };
  }, [palette, entries]);

  return (
    <ChartFrame
      title="Conversion funnel"
      description="Applied to offer, with conversion at each step"
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      isEmpty={entries.every((entry) => entry.count === 0)}
      emptyMessage="Nothing has entered the funnel yet."
    >
      <>
        <div className="h-full" data-testid="funnel-bar">
          <Bar data={data} options={options} />
        </div>
        <ChartDataSummary
          caption="Conversion funnel from applied to offer"
          valueHeading="Reached, conversion from applied"
          rows={entries.map((entry) => ({
            label: stageLabel(entry.stage),
            value:
              String(entry.count) +
              ' reached, ' +
              percent(entry.conversionFromApplied) +
              ' of applied',
          }))}
        />
      </>
    </ChartFrame>
  );
}
