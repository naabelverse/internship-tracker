/**
 * The single source of query keys. Nothing may pass an inline array to
 * TanStack Query — invalidation depends on prefixes matching exactly, and a
 * typo in a literal is invisible until a cache fails to update.
 *
 * Later phases add branches here (applications, analytics, calendar, reminders)
 * rather than declaring keys next to the hooks that use them.
 */
const auth = {
  all: ['auth'] as const,
  session: () => ['auth', 'session'] as const,
};

export const queryKeys = { auth } as const;
