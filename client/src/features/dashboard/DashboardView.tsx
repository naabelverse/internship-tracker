import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { PlusIcon } from '@/components/ui/icons';
import { ApplicationFormModal } from '@/features/applications/ApplicationFormModal';
import { ActivityHeatmap } from '@/features/dashboard/ActivityHeatmap';
import { DashboardEmptyState } from '@/features/dashboard/DashboardEmptyState';
import { StatCards } from '@/features/dashboard/StatCards';
import { UpcomingPanel } from '@/features/dashboard/UpcomingPanel';
import { FunnelBar } from '@/features/dashboard/charts/FunnelBar';
import { SourceBar } from '@/features/dashboard/charts/SourceBar';
import { StatusDoughnut } from '@/features/dashboard/charts/StatusDoughnut';
import { TimelineChart } from '@/features/dashboard/charts/TimelineChart';
import { TopCompaniesBar } from '@/features/dashboard/charts/TopCompaniesBar';
import {
  useBreakdownQueries,
  useHeatmapQuery,
  useSummaryQuery,
  useTimelineQuery,
  useUpcomingQuery,
} from '@/features/dashboard/useDashboardQueries';
import { ErrorState } from '@/components/ui/ErrorState';
import { DashboardSkeleton } from '@/features/dashboard/DashboardSkeleton';
import type { TimelineGranularity } from '@/types/analytics';

/**
 * The dashboard body. It lives behind `React.lazy` in the route table, so
 * Chart.js is fetched the first time someone opens this page and never on the
 * applications, board or calendar routes.
 */
export function DashboardView(): JSX.Element {
  const [granularity, setGranularity] = useState<TimelineGranularity>('week');
  const [isCreateOpen, setCreateOpen] = useState(false);

  const summary = useSummaryQuery();
  const timeline = useTimelineQuery(granularity);
  const heatmap = useHeatmapQuery();
  const upcoming = useUpcomingQuery();
  const { statusBreakdown, bySource, funnel, topCompanies } = useBreakdownQueries();

  const openCreate = (): void => {
    setCreateOpen(true);
  };

  // The summary is the one request that decides which page this is, so its own
  // loading and error states are the page's rather than a card's.
  if (summary.isPending) return <DashboardSkeleton />;

  if (summary.isError) {
    return (
      <ErrorState
        error={summary.error}
        fallback="Your dashboard could not load."
        onRetry={() => void summary.refetch()}
        isRetrying={summary.isFetching}
      />
    );
  }

  const isEmptyAccount = summary.data.total === 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-display-sm stretch-wide text-content">Dashboard</h1>
          <p className="mt-0.5 text-sm text-content-muted">
            {summary.data.currentStreakDays > 0
              ? `${String(summary.data.currentStreakDays)} day streak — keep it going.`
              : 'Your search at a glance.'}
          </p>
        </div>
        <Button onClick={openCreate}>
          <PlusIcon className="h-4 w-4" aria-hidden="true" />
          New application
        </Button>
      </header>

      {isEmptyAccount ? (
        <DashboardEmptyState onCreate={openCreate} />
      ) : (
        <>
          <StatCards summary={summary.data} isLoading={false} />

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <TimelineChart
                timeline={timeline.data}
                granularity={granularity}
                onGranularityChange={setGranularity}
                isLoading={timeline.isPending}
                error={timeline.error}
                onRetry={() => void timeline.refetch()}
              />
            </div>
            <UpcomingPanel
              events={upcoming.data}
              isLoading={upcoming.isPending}
              error={upcoming.error}
              onRetry={() => void upcoming.refetch()}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <StatusDoughnut
              breakdown={statusBreakdown.data}
              isLoading={statusBreakdown.isPending}
              error={statusBreakdown.error}
              onRetry={() => void statusBreakdown.refetch()}
            />
            <SourceBar
              sources={bySource.data}
              isLoading={bySource.isPending}
              error={bySource.error}
              onRetry={() => void bySource.refetch()}
            />
            <FunnelBar
              stages={funnel.data}
              isLoading={funnel.isPending}
              error={funnel.error}
              onRetry={() => void funnel.refetch()}
            />
            <TopCompaniesBar
              companies={topCompanies.data}
              isLoading={topCompanies.isPending}
              error={topCompanies.error}
              onRetry={() => void topCompanies.refetch()}
            />
          </div>

          <ActivityHeatmap points={heatmap.data?.points} isLoading={heatmap.isPending} />
        </>
      )}

      <ApplicationFormModal
        isOpen={isCreateOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
      />
    </div>
  );
}
