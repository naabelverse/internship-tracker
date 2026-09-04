import type { ApplicationStatus } from '@/types/application';

/**
 * One comparison window's numbers, measured on the cohort of applications
 * created inside it. Both windows are asked the same question of the same kind
 * of population, which is what makes a card delta mean anything.
 */
export interface PeriodMetrics {
  created: number;
  active: number;
  applied: number;
  responded: number;
  interviewed: number;
  offers: number;
  responseRate: number;
}

export interface PeriodComparison {
  days: number;
  current: PeriodMetrics;
  previous: PeriodMetrics;
}

export interface WeeklyGoal {
  target: number;
  completed: number;
  percentage: number;
  previousCompleted: number;
}

/** `GET /analytics/summary`. */
export interface AnalyticsSummary {
  total: number;
  active: number;
  applied: number;
  responded: number;
  interviewed: number;
  offers: number;
  responseRate: number;
  interviewRate: number;
  offerRate: number;
  avgDaysToFirstResponse: number | null;
  currentStreakDays: number;
  weeklyGoal: WeeklyGoal;
  period: PeriodComparison;
}

export interface StatusBreakdownEntry {
  status: ApplicationStatus;
  count: number;
}

export interface SourceEntry {
  source: string;
  count: number;
}

export interface CompanyEntry {
  company: string;
  count: number;
}

export interface FunnelStage {
  stage: string;
  count: number;
  conversionFromApplied: number;
  conversionFromPrevious: number;
}

export const TIMELINE_GRANULARITIES = ['day', 'week', 'month'] as const;
export type TimelineGranularity = (typeof TIMELINE_GRANULARITIES)[number];

export const TIMELINE_RANGES = ['30d', '90d', '1y'] as const;
export type TimelineRange = (typeof TIMELINE_RANGES)[number];

/** A bucket the server had activity in; filling the gaps is the chart's job. */
export interface TimelinePoint {
  /** ISO instant at the start of the bucket. */
  bucket: string;
  created: number;
  statusChanges: number;
}

export interface Timeline {
  granularity: TimelineGranularity;
  range: TimelineRange;
  points: TimelinePoint[];
}
