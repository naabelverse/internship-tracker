import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import * as applicationsApi from '@/api/applications';
import { getErrorMessage } from '@/api/errors';
import { saveFile, type DownloadedFile } from '@/lib/download';

/**
 * Downloads the account's applications as a CSV.
 *
 * A mutation rather than a query, even though the request is a `GET`: this is an
 * action the user takes, it has a side effect outside React (a file lands on
 * their disk), and nothing should refetch or cache it. Modelled as a query it
 * would re-download on every focus.
 *
 * SPEC section 17's manual pass ends with "export CSV", so this is reachable
 * from the applications toolbar rather than only from the API.
 */
export function useExportApplications(): UseMutationResult<DownloadedFile, unknown, void> {
  return useMutation({
    mutationFn: () => applicationsApi.exportApplications('csv'),
    onSuccess: (file) => {
      saveFile(file);
      toast.success('Your applications are downloading.');
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'The export could not be created.'));
    },
  });
}
