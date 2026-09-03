import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/api/queryKeys';
import type { ApplicationListPage } from '@/api/applications';
import type { Application } from '@/types/application';

/** Undoes everything a single optimistic write touched. */
export type RestoreCache = () => void;

type CacheEntry = [readonly unknown[], unknown];

/**
 * Snapshots every cached entry under the applications prefix and returns the
 * closure that puts them all back, byte for byte.
 *
 * Sweeping the whole prefix rather than one key is the point: the same row is
 * cached under every filter combination the user has visited plus its own detail
 * entry, so patching only the active page would leave stale copies that reappear
 * the moment the user hits Back.
 */
function snapshot(queryClient: QueryClient): RestoreCache {
  const entries = queryClient.getQueriesData({
    queryKey: queryKeys.applications.all,
  }) as CacheEntry[];

  return () => {
    for (const [key, data] of entries) {
      queryClient.setQueryData(key, data);
    }
  };
}

function isListPage(value: unknown): value is ApplicationListPage {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as ApplicationListPage).applications)
  );
}

function isApplication(value: unknown): value is Application {
  return (
    typeof value === 'object' && value !== null && typeof (value as Application).id === 'string'
  );
}

/** Rewrites one application everywhere it is cached, leaving other rows untouched. */
function mapCachedApplication(
  queryClient: QueryClient,
  id: string,
  map: (application: Application) => Application | null,
): void {
  queryClient.setQueriesData({ queryKey: queryKeys.applications.lists() }, (data: unknown) => {
    if (!isListPage(data)) return data;
    if (!data.applications.some((application) => application.id === id)) return data;

    const applications: Application[] = [];
    for (const application of data.applications) {
      if (application.id !== id) {
        applications.push(application);
        continue;
      }

      const mapped = map(application);
      if (mapped !== null) applications.push(mapped);
    }

    return { ...data, applications };
  });

  queryClient.setQueriesData({ queryKey: queryKeys.applications.details() }, (data: unknown) => {
    if (!isApplication(data) || data.id !== id) return data;
    return map(data) ?? data;
  });
}

/**
 * Applies `patch` to one application in every cache that holds it and returns
 * the restore closure. The caller keeps that closure and calls it from `onError`.
 */
export function patchCachedApplication(
  queryClient: QueryClient,
  id: string,
  patch: Partial<Application>,
): RestoreCache {
  const restore = snapshot(queryClient);
  mapCachedApplication(queryClient, id, (application) => ({ ...application, ...patch }));

  return restore;
}

/** Drops applications from every cached list, for an optimistic delete. */
export function removeCachedApplications(
  queryClient: QueryClient,
  ids: readonly string[],
): RestoreCache {
  const restore = snapshot(queryClient);

  for (const id of ids) {
    mapCachedApplication(queryClient, id, () => null);
  }

  return restore;
}

/** Applies the same patch to many rows, for an optimistic bulk action. */
export function patchCachedApplications(
  queryClient: QueryClient,
  ids: readonly string[],
  patch: Partial<Application>,
): RestoreCache {
  const restore = snapshot(queryClient);

  for (const id of ids) {
    mapCachedApplication(queryClient, id, (application) => ({ ...application, ...patch }));
  }

  return restore;
}

/**
 * Puts a not-yet-saved row at the head of every cached list so a create shows up
 * immediately. The restore closure removes it again if the request fails.
 */
export function insertCachedApplication(
  queryClient: QueryClient,
  draft: Application,
): RestoreCache {
  const restore = snapshot(queryClient);

  queryClient.setQueriesData({ queryKey: queryKeys.applications.lists() }, (data: unknown) => {
    if (!isListPage(data)) return data;

    return {
      ...data,
      applications: [draft, ...data.applications],
      meta: { ...data.meta, total: data.meta.total + 1 },
    };
  });

  return restore;
}

/** Replaces the temporary row a create inserted with the document the server returned. */
export function replaceCachedApplication(
  queryClient: QueryClient,
  temporaryId: string,
  saved: Application,
): void {
  mapCachedApplication(queryClient, temporaryId, () => saved);
  queryClient.setQueryData(queryKeys.applications.detail(saved.id), saved);
}

/** Writes the server's authoritative document over whatever was optimistic. */
export function commitCachedApplication(queryClient: QueryClient, saved: Application): void {
  mapCachedApplication(queryClient, saved.id, () => saved);
  queryClient.setQueryData(queryKeys.applications.detail(saved.id), saved);
}
