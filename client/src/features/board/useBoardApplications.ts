import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { listApplications, type ApplicationListPage } from '@/api/applications';
import { queryKeys } from '@/api/queryKeys';
import { BOARD_LIMIT } from '@/features/board/boardColumns';
import { EMPTY_FILTERS, type ApplicationFilters } from '@/features/applications/filterParams';

/** Archived rows are out of the funnel, so the board asks for live ones only. */
export const BOARD_FILTERS: ApplicationFilters = {
  ...EMPTY_FILTERS,
  limit: BOARD_LIMIT,
  sort: 'updatedAt:desc',
};

/**
 * The board's page shares the applications list key shape, so the optimistic
 * cache helpers reach it with no board-specific handling: a status change made
 * from the table patches the board's copy too, and the reverse.
 */
export function useBoardApplications(): UseQueryResult<ApplicationListPage> {
  return useQuery({
    queryKey: queryKeys.applications.list(BOARD_FILTERS),
    queryFn: () => listApplications(BOARD_FILTERS),
  });
}
