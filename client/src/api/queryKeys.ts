import type { ApplicationFilters } from '@/features/applications/filterParams';

/**
 * The single source of query keys. Nothing may pass an inline array to
 * TanStack Query — invalidation depends on prefixes matching exactly, and a
 * typo in a literal is invisible until a cache fails to update.
 *
 * Later phases add branches here rather than declaring keys next to the hooks
 * that use them.
 */
const auth = {
  all: ['auth'] as const,
  session: () => ['auth', 'session'] as const,
  sessions: () => ['auth', 'sessions'] as const,
};

const applications = {
  /**
   * The prefix the optimistic cache helpers sweep: every list page under every
   * filter combination, plus every detail entry, hangs off it.
   */
  all: ['applications'] as const,
  lists: () => ['applications', 'list'] as const,
  list: (filters: ApplicationFilters) => ['applications', 'list', filters] as const,
  details: () => ['applications', 'detail'] as const,
  detail: (id: string) => ['applications', 'detail', id] as const,
};

const analytics = {
  /** Everything the dashboard reads, so one write can invalidate the lot. */
  all: ['analytics'] as const,
  summary: (periodDays: number) => ['analytics', 'summary', periodDays] as const,
  statusBreakdown: () => ['analytics', 'status-breakdown'] as const,
  /** Granularity is part of the key, so switching day/week/month refetches. */
  timeline: (granularity: string, range: string) =>
    ['analytics', 'timeline', granularity, range] as const,
  bySource: () => ['analytics', 'by-source'] as const,
  funnel: () => ['analytics', 'funnel'] as const,
  topCompanies: (limit: number) => ['analytics', 'top-companies', limit] as const,
};

const calendar = {
  all: ['calendar'] as const,
  /** The window is part of the key, so changing month is what refetches. */
  range: (from: string, to: string) => ['calendar', from, to] as const,
};

export const queryKeys = { auth, applications, analytics, calendar } as const;
