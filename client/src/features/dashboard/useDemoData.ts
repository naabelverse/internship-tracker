import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { loadDemoData } from '@/api/demoData';
import { getErrorMessage } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';

/**
 * Fills an empty account with the fixture set behind the dashboard empty state.
 *
 * Everything the dashboard reads is derived from applications, so a success
 * invalidates the analytics, applications and calendar trees wholesale rather
 * than trying to patch six aggregate caches by hand.
 */
export function useLoadDemoData(): UseMutationResult<number, unknown, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: loadDemoData,
    onSuccess: async (inserted) => {
      toast.success(`Loaded ${String(inserted)} sample applications`);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.applications.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all }),
      ]);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Demo data could not be loaded.'));
    },
  });
}
