import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  EMPTY_FILTERS,
  parseFilters,
  toSearchParams,
  type ApplicationFilters,
} from '@/features/applications/filterParams';

interface UseApplicationFilters {
  filters: ApplicationFilters;
  /**
   * Merges a partial change into the URL. Every change except an explicit page
   * move resets to page 1, because holding page 7 while narrowing a filter
   * usually lands on an empty result the user did not ask for.
   */
  setFilters: (patch: Partial<ApplicationFilters>, options?: { replace?: boolean }) => void;
  clearFilters: () => void;
}

/**
 * The URL is the only store for list state. The query key is derived from what
 * is parsed here, so changing the address is what triggers a refetch, and there
 * is no second copy of the filters that could disagree with the link the user
 * would share. A fresh mount and a client-side navigation therefore take the
 * identical path.
 */
export function useApplicationFilters(): UseApplicationFilters {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);

  const setFilters = useCallback(
    (patch: Partial<ApplicationFilters>, options?: { replace?: boolean }) => {
      const next: ApplicationFilters = {
        ...parseFilters(searchParams),
        ...patch,
        page: patch.page ?? 1,
      };

      setSearchParams(toSearchParams(next), { replace: options?.replace ?? false });
    },
    [searchParams, setSearchParams],
  );

  const clearFilters = useCallback(() => {
    setSearchParams(toSearchParams(EMPTY_FILTERS), { replace: false });
  }, [setSearchParams]);

  return { filters, setFilters, clearFilters };
}
