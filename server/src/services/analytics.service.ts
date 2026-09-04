import type { PipelineStage, Types } from 'mongoose';
import { Application, APPLICATION_STATUSES, type ApplicationStatus } from '@/models/Application';
import { localDayKey, previousDayKey, startOfLocalWeek } from '@/utils/dates';

const MS_PER_DAY = 86_400_000;

/** Reaching any of these means the application was actually submitted. */
const APPLIED_OR_BEYOND = [
  'applied',
  'assessment',
  'interview',
  'offer',
  'rejected',
  'ghosted',
] as const;

/** A company came back with something, good or bad. Ghosted deliberately is not here. */
const RESPONSE_STATUSES = ['assessment', 'interview', 'offer', 'rejected'] as const;
const INTERVIEW_STATUSES = ['interview', 'offer'] as const;
const OFFER_STATUSES = ['offer'] as const;
const ACTIVE_STATUSES = ['applied', 'assessment', 'interview'] as const;

/**
 * Every pipeline starts here. Scoping by user in `$match` is the aggregation
 * equivalent of the ownership rule the query layer follows, and it must be the
 * first stage so no later stage can ever see another account rows.
 */
function scopedToUser(userId: Types.ObjectId): PipelineStage.Match {
  return { $match: { user: userId } };
}

/**
 * Collapses the current status and every status the record has ever held into
 * one set, so "did this ever reach interview" is a set intersection rather than
 * a scan of the history array in JavaScript.
 */
const withHistoryStatuses: PipelineStage = {
  $addFields: {
    historyStatuses: {
      $setUnion: [
        {
          $map: {
            input: { $ifNull: ['$statusHistory', []] },
            as: 'entry',
            in: '$$entry.to',
          },
        },
        ['$status'],
      ],
    },
  },
};

function reached(statuses: readonly string[]): Record<string, unknown> {
  return { $gt: [{ $size: { $setIntersection: ['$historyStatuses', statuses] } }, 0] };
}

/** First time the record entered a given set of statuses, from its own history. */
function firstEntryAt(statuses: readonly string[]): Record<string, unknown> {
  return {
    $arrayElemAt: [
      {
        $map: {
          input: {
            $filter: {
              input: { $ifNull: ['$statusHistory', []] },
              as: 'entry',
              cond: { $in: ['$$entry.to', statuses] },
            },
          },
          as: 'entry',
          in: '$$entry.changedAt',
        },
      },
      0,
    ],
  };
}

const withMilestones: PipelineStage = {
  $addFields: {
    isApplied: reached(APPLIED_OR_BEYOND),
    isResponded: reached(RESPONSE_STATUSES),
    isInterviewed: reached(INTERVIEW_STATUSES),
    isOffered: reached(OFFER_STATUSES),
    appliedAt: { $ifNull: [firstEntryAt(['applied']), '$createdAt'] },
    respondedAt: firstEntryAt(RESPONSE_STATUSES),
  },
};

function percentage(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * One window's worth of the headline numbers, measured on the cohort of
 * applications *created* inside that window.
 *
 * Cohort rather than event framing is what makes the two windows comparable:
 * every metric is asked of the same population, so a delta says "this batch of
 * applications did better than the last batch" rather than mixing an all-time
 * total with a windowed one.
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

/** The current window and the window of equal length immediately before it. */
export interface PeriodComparison {
  days: number;
  current: PeriodMetrics;
  previous: PeriodMetrics;
}

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
  weeklyGoal: {
    target: number;
    completed: number;
    percentage: number;
    /** Same window one week earlier, so the goal card can show a delta too. */
    previousCompleted: number;
  };
  /** SPEC section 6: every stat card carries a delta against the last period. */
  period: PeriodComparison;
}

interface CountRow {
  count: number;
}
interface AverageRow {
  avgDays: number | null;
}
interface DayKeyRow {
  _id: string;
}

/** What one cohort `$group` emits; every field is counted in the same pass. */
interface CohortRow {
  created: number;
  active: number;
  applied: number;
  responded: number;
  interviewed: number;
  offers: number;
}

interface SummaryFacet {
  total: CountRow[];
  active: CountRow[];
  applied: CountRow[];
  responded: CountRow[];
  interviewed: CountRow[];
  offered: CountRow[];
  responseTime: AverageRow[];
  thisWeek: CountRow[];
  lastWeek: CountRow[];
  periodCurrent: CohortRow[];
  periodPrevious: CohortRow[];
  dayKeys: DayKeyRow[];
}

const countOf = (match: Record<string, unknown>): PipelineStage.FacetPipelineStage[] => [
  { $match: match },
  { $count: 'count' },
];

const firstCount = (rows: CountRow[]): number => rows[0]?.count ?? 0;

/**
 * Every cohort number in one `$group`, so a window costs one extra facet branch
 * rather than another round trip. It runs after `withMilestones`, which is what
 * lets "ever reached interview" be a boolean test instead of a second lookup.
 */
const cohortGroup: PipelineStage.FacetPipelineStage = {
  $group: {
    _id: null,
    created: { $sum: 1 },
    active: {
      $sum: {
        $cond: [
          {
            $and: [{ $in: ['$status', [...ACTIVE_STATUSES]] }, { $eq: ['$archived', false] }],
          },
          1,
          0,
        ],
      },
    },
    applied: { $sum: { $cond: ['$isApplied', 1, 0] } },
    responded: { $sum: { $cond: ['$isResponded', 1, 0] } },
    interviewed: { $sum: { $cond: ['$isInterviewed', 1, 0] } },
    offers: { $sum: { $cond: ['$isOffered', 1, 0] } },
  },
};

/** The cohort created inside one half-open window, `[start, end)`. */
function cohortIn(start: Date, end: Date): PipelineStage.FacetPipelineStage[] {
  return [{ $match: { createdAt: { $gte: start, $lt: end } } }, cohortGroup];
}

const EMPTY_COHORT: CohortRow = {
  created: 0,
  active: 0,
  applied: 0,
  responded: 0,
  interviewed: 0,
  offers: 0,
};

function toPeriodMetrics(rows: CohortRow[]): PeriodMetrics {
  const row = rows[0] ?? EMPTY_COHORT;

  return { ...row, responseRate: percentage(row.responded, row.applied) };
}

/**
 * Walks distinct local day keys backwards from today. The grouping happens in
 * the pipeline; only the consecutive-day walk over that small, already-reduced
 * list happens here.
 */
function computeStreak(dayKeys: string[], today: string): number {
  const days = new Set(dayKeys);
  let cursor = days.has(today) ? today : previousDayKey(today);
  let streak = 0;

  while (days.has(cursor)) {
    streak += 1;
    cursor = previousDayKey(cursor);
  }

  return streak;
}

/** SPEC section 6 shows a delta against "the previous period"; this is its length. */
export const DEFAULT_PERIOD_DAYS = 30;

export async function getSummary(
  userId: Types.ObjectId,
  timeZone: string,
  weeklyGoal: number,
  now: Date = new Date(),
  periodDays: number = DEFAULT_PERIOD_DAYS,
): Promise<AnalyticsSummary> {
  const weekStart = startOfLocalWeek(now, timeZone);
  // Stepping back a day and re-resolving the week start keeps the previous week
  // seven *local* days long across a daylight saving change, which subtracting a
  // fixed number of milliseconds would not.
  const previousWeekStart = startOfLocalWeek(new Date(weekStart.getTime() - MS_PER_DAY), timeZone);

  const windowEnd = new Date(now.getTime());
  const currentStart = new Date(windowEnd.getTime() - periodDays * MS_PER_DAY);
  const previousStart = new Date(currentStart.getTime() - periodDays * MS_PER_DAY);

  const [facet] = await Application.aggregate<SummaryFacet>([
    scopedToUser(userId),
    withHistoryStatuses,
    withMilestones,
    {
      $facet: {
        total: [{ $count: 'count' }],
        active: countOf({ status: { $in: [...ACTIVE_STATUSES] }, archived: false }),
        applied: countOf({ isApplied: true }),
        responded: countOf({ isResponded: true }),
        interviewed: countOf({ isInterviewed: true }),
        offered: countOf({ isOffered: true }),
        responseTime: [
          { $match: { respondedAt: { $ne: null } } },
          {
            $group: {
              _id: null,
              avgDays: {
                $avg: { $divide: [{ $subtract: ['$respondedAt', '$appliedAt'] }, MS_PER_DAY] },
              },
            },
          },
        ],
        thisWeek: countOf({ createdAt: { $gte: weekStart } }),
        lastWeek: countOf({ createdAt: { $gte: previousWeekStart, $lt: weekStart } }),
        periodCurrent: cohortIn(currentStart, windowEnd),
        periodPrevious: cohortIn(previousStart, currentStart),
        // Distinct local days with activity, newest first, for the streak walk.
        dayKeys: [
          {
            $group: {
              _id: {
                $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: timeZone },
              },
            },
          },
          { $sort: { _id: -1 } },
          { $limit: 400 },
        ],
      },
    },
  ]);

  const applied = firstCount(facet.applied);
  const responded = firstCount(facet.responded);
  const interviewed = firstCount(facet.interviewed);
  const offers = firstCount(facet.offered);
  const completed = firstCount(facet.thisWeek);
  const average = facet.responseTime[0]?.avgDays ?? null;

  return {
    total: firstCount(facet.total),
    active: firstCount(facet.active),
    applied,
    responded,
    interviewed,
    offers,
    responseRate: percentage(responded, applied),
    interviewRate: percentage(interviewed, applied),
    offerRate: percentage(offers, applied),
    avgDaysToFirstResponse: average === null ? null : Math.round(average * 10) / 10,
    currentStreakDays: computeStreak(
      facet.dayKeys.map((row) => row._id),
      localDayKey(now, timeZone),
    ),
    weeklyGoal: {
      target: weeklyGoal,
      completed,
      percentage: percentage(completed, weeklyGoal),
      previousCompleted: firstCount(facet.lastWeek),
    },
    period: {
      days: periodDays,
      current: toPeriodMetrics(facet.periodCurrent),
      previous: toPeriodMetrics(facet.periodPrevious),
    },
  };
}

export interface StatusBreakdownEntry {
  status: ApplicationStatus;
  count: number;
}

export async function getStatusBreakdown(userId: Types.ObjectId): Promise<StatusBreakdownEntry[]> {
  const rows = await Application.aggregate<{ _id: ApplicationStatus; count: number }>([
    scopedToUser(userId),
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const counts = new Map(rows.map((row) => [row._id, row.count]));

  // Every status is returned, including the empty ones, so the doughnut chart
  // keeps a stable set of slices instead of reshuffling as data arrives.
  return APPLICATION_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 }));
}

export interface SourceEntry {
  source: string;
  count: number;
}

export async function getBySource(userId: Types.ObjectId): Promise<SourceEntry[]> {
  const rows = await Application.aggregate<{ _id: string; count: number }>([
    scopedToUser(userId),
    { $group: { _id: { $ifNull: ['$source', 'unspecified'] }, count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);

  return rows.map((row) => ({ source: row._id, count: row.count }));
}

export interface CompanyEntry {
  company: string;
  count: number;
}

export async function getTopCompanies(userId: Types.ObjectId, limit = 10): Promise<CompanyEntry[]> {
  const rows = await Application.aggregate<{ _id: string; count: number }>([
    scopedToUser(userId),
    { $group: { _id: '$company', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: limit },
  ]);

  return rows.map((row) => ({ company: row._id, count: row.count }));
}

export interface FunnelStage {
  stage: string;
  count: number;
  /** Share of the applied cohort that reached this stage. */
  conversionFromApplied: number;
  /** Share of the previous stage that converted into this one. */
  conversionFromPrevious: number;
}

export async function getFunnel(userId: Types.ObjectId): Promise<FunnelStage[]> {
  const [facet] = await Application.aggregate<Record<string, CountRow[]>>([
    scopedToUser(userId),
    withHistoryStatuses,
    {
      $facet: {
        applied: countOf({
          $expr: {
            $gt: [{ $size: { $setIntersection: ['$historyStatuses', APPLIED_OR_BEYOND] } }, 0],
          },
        }),
        assessment: countOf({ historyStatuses: 'assessment' }),
        interview: countOf({ historyStatuses: 'interview' }),
        offer: countOf({ historyStatuses: 'offer' }),
      },
    },
  ]);

  const counts = [
    { stage: 'applied', count: firstCount(facet.applied) },
    { stage: 'assessment', count: firstCount(facet.assessment) },
    { stage: 'interview', count: firstCount(facet.interview) },
    { stage: 'offer', count: firstCount(facet.offer) },
  ];

  const appliedTotal = counts[0].count;

  return counts.map((entry, index) => ({
    ...entry,
    conversionFromApplied: percentage(entry.count, appliedTotal),
    conversionFromPrevious: index === 0 ? 100 : percentage(entry.count, counts[index - 1].count),
  }));
}

export type Granularity = 'day' | 'week' | 'month';
export type TimelineRange = '30d' | '90d' | '1y';

const RANGE_DAYS: Record<TimelineRange, number> = { '30d': 30, '90d': 90, '1y': 365 };

export interface TimelinePoint {
  bucket: string;
  created: number;
  statusChanges: number;
}

interface BucketRow {
  _id: Date;
  count: number;
}

/** Bucket boundaries follow the user calendar, not the server one. */
function truncate(field: string, unit: Granularity, timeZone: string): Record<string, unknown> {
  return {
    $dateTrunc: {
      date: field,
      unit,
      timezone: timeZone,
      ...(unit === 'week' ? { startOfWeek: 'monday' } : {}),
    },
  };
}

/**
 * Applications created and status changes made, bucketed together. Only buckets
 * with activity are returned; the chart fills the gaps, which keeps the payload
 * small over a one year range.
 */
export async function getTimeline(
  userId: Types.ObjectId,
  timeZone: string,
  granularity: Granularity,
  range: TimelineRange,
  now: Date = new Date(),
): Promise<TimelinePoint[]> {
  const start = new Date(now.getTime() - RANGE_DAYS[range] * MS_PER_DAY);
  const window = { $gte: start, $lte: now };

  const [facet] = await Application.aggregate<{ created: BucketRow[]; changes: BucketRow[] }>([
    scopedToUser(userId),
    {
      $facet: {
        created: [
          { $match: { createdAt: window } },
          { $group: { _id: truncate('$createdAt', granularity, timeZone), count: { $sum: 1 } } },
        ],
        changes: [
          { $unwind: '$statusHistory' },
          { $match: { 'statusHistory.changedAt': window } },
          {
            $group: {
              _id: truncate('$statusHistory.changedAt', granularity, timeZone),
              count: { $sum: 1 },
            },
          },
        ],
      },
    },
  ]);

  const buckets = new Map<string, TimelinePoint>();

  const upsert = (at: Date, key: 'created' | 'statusChanges', count: number): void => {
    const bucket = at.toISOString();
    const existing = buckets.get(bucket) ?? { bucket, created: 0, statusChanges: 0 };
    existing[key] += count;
    buckets.set(bucket, existing);
  };

  for (const row of facet.created) upsert(row._id, 'created', row.count);
  for (const row of facet.changes) upsert(row._id, 'statusChanges', row.count);

  return [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}
