import type {
  AnalyticsSummary,
  CompanyEntry,
  FunnelStage,
  SourceEntry,
  StatusBreakdownEntry,
  Timeline,
  TimelinePoint,
} from '@/types/analytics';
import type { ApiErrorBody, ApiSuccessBody, PaginationMeta } from '@/types/api';
import type { Application, Attachment, Interview } from '@/types/application';
import type { CalendarEvent } from '@/types/calendar';
import type { AuthSession, User } from '@/types/user';

let sequence = 0;

/** Distinct ids and emails per call, so two users in one test cannot collide. */
export function makeUser(overrides: Partial<User> = {}): User {
  sequence += 1;

  return {
    id: `user-${String(sequence)}`,
    name: 'Ada Lovelace',
    email: `ada-${String(sequence)}@example.test`,
    targetRoles: ['Backend Intern'],
    weeklyGoal: 5,
    theme: 'system',
    timezone: 'Asia/Kuala_Lumpur',
    emailRemindersEnabled: true,
    // Off by default, matching the server: the weekly summary is opt-in, so a
    // factory that turned it on would be describing an account nobody has.
    weeklySummaryEnabled: false,
    // Verified by default: the ordinary account most cases are about. Left
    // unverified, every authenticated page carries Phase 11's banner - which is
    // correct behaviour, but noise in a test about something else, and its
    // `role="alert"` collides with the alerts those tests query for. Cases that
    // exercise verification set this explicitly.
    emailVerified: true,
    isDemo: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return { user: makeUser(), accessToken: 'access-token-1', ...overrides };
}

export function successBody<T>(data: T, message?: string): ApiSuccessBody<T> {
  return message === undefined ? { success: true, data } : { success: true, data, message };
}

export function errorBody(
  message: string,
  code: string,
  errors?: Record<string, string[]>,
): ApiErrorBody {
  return errors === undefined
    ? { success: false, message, code }
    : { success: false, message, code, errors };
}

export function makeInterview(overrides: Partial<Interview> = {}): Interview {
  sequence += 1;

  return {
    id: `interview-${String(sequence)}`,
    type: 'technical',
    scheduledAt: '2026-02-10T09:00:00.000Z',
    mode: 'video',
    outcome: 'pending',
    ...overrides,
  };
}

export function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  sequence += 1;

  return {
    id: `attachment-${String(sequence)}`,
    originalName: 'resume.pdf',
    mimeType: 'application/pdf',
    size: 120_000,
    url: 'https://files.example.test/resume.pdf',
    uploadedAt: '2026-01-20T00:00:00.000Z',
    ...overrides,
  };
}

export function makeApplication(overrides: Partial<Application> = {}): Application {
  sequence += 1;

  return {
    id: `application-${String(sequence)}`,
    company: `Company ${String(sequence)}`,
    role: 'Backend Intern',
    employmentType: 'internship',
    status: 'applied',
    priority: 'medium',
    source: 'linkedin',
    tags: ['backend'],
    interviews: [],
    statusHistory: [
      { from: null, to: 'saved', changedAt: '2026-01-01T00:00:00.000Z' },
      { from: 'saved', to: 'applied', changedAt: '2026-01-05T00:00:00.000Z' },
    ],
    archived: false,
    attachments: [],
    version: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-05T00:00:00.000Z',
    ...overrides,
  };
}

/** The list envelope the API returns, with `meta` derived from the rows given. */
export function makeListResponse(
  applications: Application[],
  meta: Partial<PaginationMeta> = {},
): ApiSuccessBody<{ applications: Application[] }> {
  const limit = meta.limit ?? 20;
  const total = meta.total ?? applications.length;

  return {
    success: true,
    data: { applications },
    meta: {
      total,
      page: meta.page ?? 1,
      limit,
      totalPages: meta.totalPages ?? Math.max(Math.ceil(total / limit), 1),
    },
  };
}

export function makeCalendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  sequence += 1;

  return {
    id: `deadline:event-${String(sequence)}`,
    applicationId: `application-${String(sequence)}`,
    kind: 'deadline',
    at: '2026-02-11T00:00:00.000Z',
    company: 'Stripe',
    role: 'Backend Intern',
    status: 'applied',
    ...overrides,
  };
}

/**
 * Analytics fixtures. Every field the dashboard reads has a value, so a test
 * that cares about one number does not have to spell out the other twelve.
 */
export function makeSummary(overrides: Partial<AnalyticsSummary> = {}): AnalyticsSummary {
  return {
    total: 42,
    active: 11,
    applied: 38,
    responded: 19,
    interviewed: 9,
    offers: 3,
    responseRate: 50,
    interviewRate: 23.7,
    offerRate: 7.9,
    avgDaysToFirstResponse: 6.4,
    currentStreakDays: 4,
    weeklyGoal: { target: 5, completed: 3, percentage: 60, previousCompleted: 1 },
    period: {
      days: 30,
      current: {
        created: 12,
        active: 7,
        applied: 11,
        responded: 6,
        interviewed: 4,
        offers: 2,
        responseRate: 54.5,
        interviewRate: 36.4,
        avgDaysToFirstResponse: 5.2,
      },
      previous: {
        created: 8,
        active: 4,
        applied: 8,
        responded: 3,
        interviewed: 1,
        offers: 1,
        responseRate: 37.5,
        interviewRate: 12.5,
        avgDaysToFirstResponse: 7.8,
      },
    },
    ...overrides,
  };
}

/** An account with nothing in it, which is what the empty state keys off. */
export function makeEmptySummary(): AnalyticsSummary {
  const zeroed = {
    created: 0,
    active: 0,
    applied: 0,
    responded: 0,
    interviewed: 0,
    offers: 0,
    responseRate: 0,
    interviewRate: 0,
    avgDaysToFirstResponse: null,
  };

  return makeSummary({
    total: 0,
    active: 0,
    applied: 0,
    responded: 0,
    interviewed: 0,
    offers: 0,
    responseRate: 0,
    interviewRate: 0,
    offerRate: 0,
    avgDaysToFirstResponse: null,
    currentStreakDays: 0,
    weeklyGoal: { target: 5, completed: 0, percentage: 0, previousCompleted: 0 },
    period: { days: 30, current: zeroed, previous: zeroed },
  });
}

export function makeStatusBreakdown(): StatusBreakdownEntry[] {
  return [
    { status: 'saved', count: 4 },
    { status: 'applied', count: 12 },
    { status: 'assessment', count: 6 },
    { status: 'interview', count: 5 },
    { status: 'offer', count: 3 },
    { status: 'rejected', count: 9 },
    { status: 'ghosted', count: 2 },
    { status: 'withdrawn', count: 1 },
  ];
}

export function makeTimeline(overrides: Partial<Timeline> = {}): Timeline {
  return {
    granularity: 'week',
    range: '90d',
    points: [
      { bucket: '2026-08-03T00:00:00.000Z', created: 5, statusChanges: 3 },
      { bucket: '2026-08-10T00:00:00.000Z', created: 8, statusChanges: 6 },
      { bucket: '2026-08-17T00:00:00.000Z', created: 2, statusChanges: 9 },
    ],
    ...overrides,
  };
}

/** One timeline bucket; `bucket` is the UTC instant of a local day or week start. */
export function makeTimelinePoint(overrides: Partial<TimelinePoint> = {}): TimelinePoint {
  return { bucket: '2026-10-01T16:00:00.000Z', created: 1, statusChanges: 0, ...overrides };
}

export function makeFunnel(): FunnelStage[] {
  return [
    { stage: 'applied', count: 38, conversionFromApplied: 100, conversionFromPrevious: 100 },
    { stage: 'assessment', count: 16, conversionFromApplied: 42.1, conversionFromPrevious: 42.1 },
    { stage: 'interview', count: 9, conversionFromApplied: 23.7, conversionFromPrevious: 56.3 },
    { stage: 'offer', count: 3, conversionFromApplied: 7.9, conversionFromPrevious: 33.3 },
  ];
}

export function makeSources(): SourceEntry[] {
  return [
    { source: 'linkedin', count: 18 },
    { source: 'referral', count: 9 },
    { source: 'company_site', count: 7 },
    { source: 'unspecified', count: 2 },
  ];
}

export function makeTopCompanies(): CompanyEntry[] {
  return [
    { company: 'Grab', count: 6 },
    { company: 'Shopee', count: 4 },
    { company: 'Stripe', count: 3 },
  ];
}
