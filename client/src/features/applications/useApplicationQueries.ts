import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import * as applicationsApi from '@/api/applications';
import type { ApplicationListPage } from '@/api/applications';
import { queryKeys } from '@/api/queryKeys';
import type { ApplicationFilters } from '@/features/applications/filterParams';
import type { Application } from '@/types/application';

/**
 * The list query. Its key carries the parsed filters, so a change to the URL is
 * what invalidates it, and there is no separate refetch trigger to keep in step.
 * `placeholderData` keeps the previous page on screen while the next one loads,
 * so paging does not blink back to a skeleton.
 */
export function useApplicationsQuery(
  filters: ApplicationFilters,
): UseQueryResult<ApplicationListPage> {
  return useQuery({
    queryKey: queryKeys.applications.list(filters),
    queryFn: () => applicationsApi.listApplications(filters),
    placeholderData: (previous) => previous,
  });
}

export function useApplicationQuery(id: string): UseQueryResult<Application> {
  return useQuery({
    queryKey: queryKeys.applications.detail(id),
    queryFn: () => applicationsApi.getApplication(id),
  });
}
