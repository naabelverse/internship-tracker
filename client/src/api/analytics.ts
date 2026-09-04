import { apiClient } from '@/api/client';
import type { ApiSuccessBody } from '@/types/api';
import type {
  AnalyticsSummary,
  CompanyEntry,
  FunnelStage,
  SourceEntry,
  StatusBreakdownEntry,
  Timeline,
  TimelineGranularity,
  TimelineRange,
} from '@/types/analytics';

/**
 * The six dashboard endpoints. Every aggregation happens server side; nothing
 * here reduces or re-buckets a payload, so the charts and the API agree.
 */
export async function getSummary(periodDays: number): Promise<AnalyticsSummary> {
  const { data } = await apiClient.get<ApiSuccessBody<AnalyticsSummary>>('/analytics/summary', {
    params: { periodDays },
  });

  return data.data;
}

export async function getStatusBreakdown(): Promise<StatusBreakdownEntry[]> {
  const { data } = await apiClient.get<ApiSuccessBody<{ breakdown: StatusBreakdownEntry[] }>>(
    '/analytics/status-breakdown',
  );

  return data.data.breakdown;
}

export async function getTimeline(
  granularity: TimelineGranularity,
  range: TimelineRange,
): Promise<Timeline> {
  const { data } = await apiClient.get<ApiSuccessBody<Timeline>>('/analytics/timeline', {
    params: { granularity, range },
  });

  return data.data;
}

export async function getBySource(): Promise<SourceEntry[]> {
  const { data } =
    await apiClient.get<ApiSuccessBody<{ sources: SourceEntry[] }>>('/analytics/by-source');

  return data.data.sources;
}

export async function getFunnel(): Promise<FunnelStage[]> {
  const { data } =
    await apiClient.get<ApiSuccessBody<{ stages: FunnelStage[] }>>('/analytics/funnel');

  return data.data.stages;
}

export async function getTopCompanies(limit = 10): Promise<CompanyEntry[]> {
  const { data } = await apiClient.get<ApiSuccessBody<{ companies: CompanyEntry[] }>>(
    '/analytics/top-companies',
    { params: { limit } },
  );

  return data.data.companies;
}
