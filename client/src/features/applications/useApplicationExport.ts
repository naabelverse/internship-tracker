import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import * as applicationsApi from '@/api/applications';
import { getErrorMessage } from '@/api/errors';
import type { ApplicationFilters } from '@/features/applications/filterParams';
import { saveFile, type DownloadedFile } from '@/lib/download';

export interface ExportChoice {
  /** The table's visible column ids for "Shown columns"; absent for "All fields". */
  columns?: readonly string[];
}

export interface ExportRequest extends ExportChoice {
  /** The list's current view; the file carries the rows it shows (issue #83). */
  filters: ApplicationFilters;
}

/**
 * Downloads the rows the list shows as a CSV: only the fields behind the
 * table's visible columns, or every field when no columns are given.
 *
 * A mutation rather than a query, even though the request is a `GET`: this is an
 * action the user takes, it has a side effect outside React (a file lands on
 * their disk), and nothing should refetch or cache it. Modelled as a query it
 * would re-download on every focus.
 *
 * SPEC section 17's manual pass ends with "export CSV", so this is reachable
 * from the applications toolbar rather than only from the API.
 */
export function useExportApplications(): UseMutationResult<DownloadedFile, unknown, ExportRequest> {
  return useMutation({
    mutationFn: ({ filters, columns }: ExportRequest) =>
      applicationsApi.exportApplications('csv', filters, columns),
    onSuccess: (file) => {
      saveFile(file);
      toast.success('Your applications are downloading.');
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'The export could not be created.'));
    },
  });
}
