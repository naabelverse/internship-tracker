import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import * as analyticsApi from '@/api/analytics';
import { getCalendar } from '@/api/calendar';
import { queryKeys } from '@/api/queryKeys';
import type {
  AnalyticsSummary,
  CompanyEntry,
  FunnelStage,
  SourceEntry,
  StatusBreakdownEntry,
  Timeline,
  TimelineGranularity,
} from '@/types/analytics';
import type { CalendarEvent } from '@/types/calendar';

/** The window every stat card delta is measured against. */
export const SUMMARY_PERIOD_DAYS = 30;

/** Twelve weeks of daily buckets, which is exactly what the heatmap draws. */
const HEATMAP_RANGE = '90d';

const UPCOMING_WINDOW_DAYS = 60;
const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

/**
 * The window the upcoming panel asks for, truncated to the top of the hour.
 *
 * The truncation is what makes the query key stable: a raw `new Date()` would
 * produce a different `from` on every render, and since the window is part of
 * the key, the query would be invalidated and refetched forever without ever
 * settling. Rounding still lets the window move forward on its own each hour.
 */
function upcomingWindow(now: Date): { from: string; to: string } {
  const start = new Date(Math.floor(now.getTime() / MS_PER_HOUR) * MS_PER_HOUR);

  return {
    from: start.toISOString(),
    to: new Date(start.getTime() + UPCOMING_WINDOW_DAYS * MS_PER_DAY).toISOString(),
  };
}

export function useSummaryQuery(): UseQueryResult<AnalyticsSummary> {
  return useQuery({
    queryKey: queryKeys.analytics.summary(SUMMARY_PERIOD_DAYS),
    queryFn: () => analyticsApi.getSummary(SUMMARY_PERIOD_DAYS),
  });
}

export function useTimelineQuery(granularity: TimelineGranularity): UseQueryResult<Timeline> {
  return useQuery({
    queryKey: queryKeys.analytics.timeline(granularity, HEATMAP_RANGE),
    queryFn: () => analyticsApi.getTimeline(granularity, HEATMAP_RANGE),
    // Keeping the previous buckets on screen stops the card collapsing to a
    // skeleton every time someone flicks between day, week and month.
    placeholderData: (previous) => previous,
  });
}

/**
 * The heatmap always needs daily buckets, whatever the line chart is showing,
 * so it has its own query rather than borrowing the timeline's granularity.
 */
export function useHeatmapQuery(): UseQueryResult<Timeline> {
  return useQuery({
    queryKey: queryKeys.analytics.timeline('day', HEATMAP_RANGE),
    queryFn: () => analyticsApi.getTimeline('day', HEATMAP_RANGE),
  });
}

export function useUpcomingQuery(now: Date = new Date()): UseQueryResult<CalendarEvent[]> {
  const { from, to } = upcomingWindow(now);

  return useQuery({
    queryKey: queryKeys.calendar.range(from, to),
    queryFn: () => getCalendar(from, to),
  });
}

export interface BreakdownQueries {
  statusBreakdown: UseQueryResult<StatusBreakdownEntry[]>;
  bySource: UseQueryResult<SourceEntry[]>;
  funnel: UseQueryResult<FunnelStage[]>;
  topCompanies: UseQueryResult<CompanyEntry[]>;
}

/**
 * The four charts that take no parameters, issued together so the dashboard
 * makes one render pass rather than four staggered ones.
 */
export function useBreakdownQueries(): BreakdownQueries {
  const [statusBreakdown, bySource, funnel, topCompanies] = useQueries({
    queries: [
      {
        queryKey: queryKeys.analytics.statusBreakdown(),
        queryFn: analyticsApi.getStatusBreakdown,
      },
      { queryKey: queryKeys.analytics.bySource(), queryFn: analyticsApi.getBySource },
      { queryKey: queryKeys.analytics.funnel(), queryFn: analyticsApi.getFunnel },
      {
        queryKey: queryKeys.analytics.topCompanies(10),
        queryFn: () => analyticsApi.getTopCompanies(10),
      },
    ],
  });

  return {
    statusBreakdown: statusBreakdown as UseQueryResult<StatusBreakdownEntry[]>,
    bySource: bySource as UseQueryResult<SourceEntry[]>,
    funnel: funnel as UseQueryResult<FunnelStage[]>,
    topCompanies: topCompanies as UseQueryResult<CompanyEntry[]>,
  };
}
