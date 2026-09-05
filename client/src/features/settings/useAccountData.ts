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

/** How long the usage figures stay fresh. They move slowly; a refetch per visit is plenty. */
const USAGE_STALE_MS = 60_000;

export function useAccountUsage(): UseQueryResult<AccountUsage> {
  return useQuery({
    queryKey: queryKeys.auth.usage(),
    queryFn: accountApi.fetchUsage,
    staleTime: USAGE_STALE_MS,
  });
}

/**
 * Hands the export to the browser as a file.
 *
 * Built from an object URL rather than pointed at the endpoint directly, because
 * the request needs the `Authorization` header the axios client attaches - a
 * plain `<a href>` would arrive without it and get a 401. The URL is revoked on
 * the next frame; revoking synchronously races the download in Safari.
 */
function saveFile({ filename, blob }: accountApi.AccountExportFile): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
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
