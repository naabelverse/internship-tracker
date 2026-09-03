import type { ApplicationFilters } from '@/features/applications/filterParams';

/**
 * The single source of query keys. Nothing may pass an inline array to
 * TanStack Query — invalidation depends on prefixes matching exactly, and a
 * typo in a literal is invisible until a cache fails to update.
 *
 * Later phases add branches here (analytics, calendar, reminders) rather than
 * declaring keys next to the hooks that use them.
 */
const auth = {
  all: ['auth'] as const,
  session: () => ['auth', 'session'] as const,
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

export const queryKeys = { auth, applications } as const;
