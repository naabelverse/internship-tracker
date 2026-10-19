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
import { PageHeader } from '@/components/ui/PageHeader';
import { useSession } from '@/hooks/useSession';
import { DashboardSkeleton } from '@/features/dashboard/DashboardSkeleton';
import type { TimelineGranularity } from '@/types/analytics';

/**
 * The line under the heading, in a phone length and a full length.
 *
 * Below `sm` the header puts "New application" beside the heading only while
 * the line is narrower than the room left over: 159px at 360 wide, 174px at
 * 375, 189px at 390. The full lines are 379px (applications) and 184px (a
 * 12 day streak), so on a phone they pushed the button onto its own row and the
 * header grew from 48px to 124px. The short lines measure 154px and 83px.
 *
 * Only one is displayed at a time, and `display: none` also takes the other
 * out of the accessibility tree, so a screen reader hears the one on screen.
 */
function Lede({ short, full }: { short: string; full: string }): JSX.Element {
  return (
    <>
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{full}</span>
    </>
  );
}

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
  // The zone the server bucketed the heatmap's days in. The dashboard is only
  // reachable signed in, so the browser's own zone is a fallback in name only.
  const timeZone = useSession().user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

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
      <PageHeader
        title="Dashboard"
        description={
          summary.data.currentStreakDays > 0 ? (
            <Lede
              short={`${String(summary.data.currentStreakDays)} day streak`}
              full={`${String(summary.data.currentStreakDays)} day streak — keep it going.`}
            />
          ) : (
            <Lede
              short="Applications, what's due."
              full="Your applications, replies and interviews, and what's due next."
            />
          )
        }
        actions={
          <Button onClick={openCreate}>
            <PlusIcon className="h-4 w-4" aria-hidden="true" />
            New application
          </Button>
        }
      />

      {isEmptyAccount ? (
        <DashboardEmptyState onCreate={openCreate} />
      ) : (
        <>
          <StatCards summary={summary.data} isLoading={false} />

          <div className="grid gap-4 lg:grid-cols-3">
            {/* The grid item here is this wrapper, not the chart's card. */}
            <div className="min-w-0 lg:col-span-2">
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

          <ActivityHeatmap
            points={heatmap.data?.points}
            timeZone={timeZone}
            weeklyGoal={summary.data.weeklyGoal.target}
            isLoading={heatmap.isPending}
          />
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
