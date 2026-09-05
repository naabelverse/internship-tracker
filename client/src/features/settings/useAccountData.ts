import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import toast from 'react-hot-toast';
import * as accountApi from '@/api/account';
import type { AccountUsage } from '@/api/account';
import { getErrorMessage } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { saveFile } from '@/lib/download';

/** How long the usage figures stay fresh. They move slowly; a refetch per visit is plenty. */
const USAGE_STALE_MS = 60_000;

export function useAccountUsage(): UseQueryResult<AccountUsage> {
  return useQuery({
    queryKey: queryKeys.auth.usage(),
    queryFn: accountApi.fetchUsage,
    staleTime: USAGE_STALE_MS,
  });
}

export function useExportAccount(): UseMutationResult<accountApi.AccountExportFile, unknown, void> {
  return useMutation({
    mutationFn: accountApi.fetchAccountExport,
    onSuccess: (file) => {
      saveFile(file);
      toast.success('Your data is downloading.');
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Your data could not be exported.'));
    },
  });
}
