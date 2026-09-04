import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import * as applicationsApi from '@/api/applications';
import type { ApplicationPayload } from '@/api/applications';
import { getApiError, getErrorMessage } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import {
  commitCachedApplication,
  insertCachedApplication,
  patchCachedApplication,
  patchCachedApplications,
  removeCachedApplications,
  replaceCachedApplication,
  type RestoreCache,
} from '@/features/applications/optimisticCache';
import type {
  Application,
  ApplicationStatus,
  BulkAction,
  BulkResult,
  VersionConflict,
} from '@/types/application';

interface OptimisticContext {
  restore: RestoreCache;
}

interface OptimisticOptions<TVariables, TResult> {
  mutationFn: (variables: TVariables) => Promise<TResult>;
  /** Writes the optimistic state and hands back the closure that undoes it. */
  optimistic: (variables: TVariables) => RestoreCache;
  onCommitted?: (result: TResult, variables: TVariables) => void;
  successMessage: (result: TResult, variables: TVariables) => string;
  errorMessage: string;
  /** Returning true suppresses the error toast, for errors with their own UI. */
  onFailure?: (error: unknown, variables: TVariables) => boolean;
}

/**
 * The one optimistic mutation shape every application write uses.
 *
 * `cancelQueries` before snapshotting is what makes the rollback trustworthy:
 * without it a refetch resolving mid-flight would overwrite the cache after the
 * snapshot was taken, and the state the rollback restores would be whatever that
 * refetch happened to return rather than what the user was looking at.
 */
function useOptimisticApplicationMutation<TVariables, TResult>({
  mutationFn,
  optimistic,
  onCommitted,
  successMessage,
  errorMessage,
  onFailure,
}: OptimisticOptions<TVariables, TResult>): UseMutationResult<
  TResult,
  unknown,
  TVariables,
  OptimisticContext
> {
  const queryClient = useQueryClient();

  return useMutation<TResult, unknown, TVariables, OptimisticContext>({
    mutationFn,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.applications.all });
      return { restore: optimistic(variables) };
    },
    onError: (error, variables, context) => {
      context?.restore();

      if (onFailure?.(error, variables) === true) return;
      toast.error(getErrorMessage(error, errorMessage));
    },
    onSuccess: (result, variables) => {
      onCommitted?.(result, variables);
      toast.success(successMessage(result, variables));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.lists() });
      // Every write moves a number the dashboard reads, and a deadline or an
      // interview moves the calendar too. Neither is patched optimistically —
      // they are server-side aggregates — so they are refetched instead.
      void queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all });
    },
  });
}

/** A row the server has not seen yet, shown while the create is in flight. */
function draftApplication(payload: ApplicationPayload, temporaryId: string): Application {
  const now = new Date().toISOString();

  return {
    id: temporaryId,
    company: payload.company ?? '',
    role: payload.role ?? '',
    companyWebsite: payload.companyWebsite,
    location: payload.location,
    workMode: payload.workMode as Application['workMode'],
    employmentType: (payload.employmentType as Application['employmentType']) ?? 'internship',
    status: (payload.status as ApplicationStatus) ?? 'saved',
    priority: (payload.priority as Application['priority']) ?? 'medium',
    source: payload.source as Application['source'],
    jobUrl: payload.jobUrl,
    appliedDate: payload.appliedDate,
    deadline: payload.deadline,
    resumeVersion: payload.resumeVersion,
    tags: payload.tags ?? [],
    notes: payload.notes,
    interviews: [],
    statusHistory: [],
    archived: payload.archived ?? false,
    attachments: [],
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function useCreateApplication(): UseMutationResult<
  Application,
  unknown,
  ApplicationPayload,
  OptimisticContext
> {
  const queryClient = useQueryClient();
  const temporaryIds = new Map<ApplicationPayload, string>();

  return useOptimisticApplicationMutation<ApplicationPayload, Application>({
    mutationFn: applicationsApi.createApplication,
    optimistic: (payload) => {
      const temporaryId = `temp-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
      temporaryIds.set(payload, temporaryId);

      return insertCachedApplication(queryClient, draftApplication(payload, temporaryId));
    },
    onCommitted: (saved, payload) => {
      const temporaryId = temporaryIds.get(payload);
      temporaryIds.delete(payload);

      if (temporaryId) replaceCachedApplication(queryClient, temporaryId, saved);
    },
    successMessage: (saved) => `${saved.company} added`,
    errorMessage: 'Could not create the application',
  });
}

export interface UpdateVariables {
  id: string;
  payload: ApplicationPayload;
  /** Shown immediately; the server document replaces it on success. */
  optimisticPatch: Partial<Application>;
}

export function useUpdateApplication(
  onVersionConflict?: (conflict: VersionConflict) => void,
): UseMutationResult<Application, unknown, UpdateVariables, OptimisticContext> {
  const queryClient = useQueryClient();

  return useOptimisticApplicationMutation<UpdateVariables, Application>({
    mutationFn: ({ id, payload }) => applicationsApi.updateApplication(id, payload),
    optimistic: ({ id, optimisticPatch }) =>
      patchCachedApplication(queryClient, id, optimisticPatch),
    onCommitted: (saved) => {
      commitCachedApplication(queryClient, saved);
    },
    successMessage: () => 'Application updated',
    errorMessage: 'Could not save the application',
    onFailure: (error) => {
      // SPEC section 7: a version conflict gets a reload or overwrite prompt
      // showing the document that won, not a toast the user cannot act on.
      const body = getApiError(error);
      if (body?.code !== 'VERSION_CONFLICT' || !onVersionConflict) return false;

      const details = body.errors as Partial<VersionConflict> | undefined;
      onVersionConflict({
        current: details?.current ?? null,
        conflictSource: details?.conflictSource ?? 'concurrent_write',
      });

      return true;
    },
  });
}

export interface StatusVariables {
  id: string;
  status: ApplicationStatus;
  note?: string;
}

export function useChangeStatus(): UseMutationResult<
  Application,
  unknown,
  StatusVariables,
  OptimisticContext
> {
  const queryClient = useQueryClient();

  return useOptimisticApplicationMutation<StatusVariables, Application>({
    mutationFn: ({ id, status, note }) => applicationsApi.changeStatus(id, status, note),
    optimistic: ({ id, status }) => patchCachedApplication(queryClient, id, { status }),
    onCommitted: (saved) => {
      commitCachedApplication(queryClient, saved);
    },
    successMessage: (saved) => `Moved to ${saved.status}`,
    errorMessage: 'Could not change the status',
  });
}

export function useDeleteApplication(): UseMutationResult<
  void,
  unknown,
  string,
  OptimisticContext
> {
  const queryClient = useQueryClient();

  return useOptimisticApplicationMutation<string, void>({
    mutationFn: applicationsApi.deleteApplication,
    optimistic: (id) => removeCachedApplications(queryClient, [id]),
    successMessage: () => 'Application deleted',
    errorMessage: 'Could not delete the application',
  });
}

export interface BulkVariables {
  ids: string[];
  action: BulkAction;
  status?: ApplicationStatus;
}

export function useBulkAction(): UseMutationResult<
  BulkResult,
  unknown,
  BulkVariables,
  OptimisticContext
> {
  const queryClient = useQueryClient();

  return useOptimisticApplicationMutation<BulkVariables, BulkResult>({
    mutationFn: ({ ids, action, status }) => applicationsApi.bulkAction(ids, action, status),
    optimistic: ({ ids, action, status }) => {
      if (action === 'delete') return removeCachedApplications(queryClient, ids);
      if (action === 'setStatus' && status) {
        return patchCachedApplications(queryClient, ids, { status });
      }

      return patchCachedApplications(queryClient, ids, { archived: action === 'archive' });
    },
    successMessage: (result) => `${String(result.modified)} applications updated`,
    errorMessage: 'The bulk action did not complete',
  });
}
