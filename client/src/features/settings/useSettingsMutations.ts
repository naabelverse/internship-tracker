import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import * as authApi from '@/api/auth';
import type { ChangePasswordPayload, UpdateMePayload } from '@/api/auth';
import { getErrorMessage } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { useAuthStore } from '@/store/authStore';
import { useThemeStore } from '@/store/themeStore';
import type { User } from '@/types/user';

/**
 * One mutation behind every account write.
 *
 * The saved user the server returns is pushed straight into the auth store, so
 * the topbar, the sidebar and any hook reading the session see the new values
 * without waiting for a refetch. The session query is invalidated as well, so a
 * later remount reads the same thing from the network rather than from a cache
 * this mutation happened to prime.
 */
function useAccountMutation(
  successMessage: string,
  errorMessage: string,
): UseMutationResult<User, unknown, UpdateMePayload> {
  const queryClient = useQueryClient();
  const setUser = useAuthStore((state) => state.setUser);

  return useMutation({
    mutationFn: authApi.updateMe,
    onSuccess: (user) => {
      setUser(user);
      queryClient.setQueryData(queryKeys.auth.session(), user);
      toast.success(successMessage);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, errorMessage));
    },
  });
}

export function useUpdateProfile(): UseMutationResult<User, unknown, UpdateMePayload> {
  return useAccountMutation('Profile saved', 'Your profile could not be saved.');
}

/**
 * Preferences share the profile endpoint but roll the theme back on failure.
 *
 * The theme is applied locally the moment it is chosen, because waiting for a
 * round trip to repaint would be visibly laggy. That optimism has to be undone
 * if the write fails, or the account and the screen disagree until the next
 * reload — which is exactly the bug the account sync exists to prevent.
 */
export function useUpdatePreferences(): UseMutationResult<User, unknown, UpdateMePayload> {
  const queryClient = useQueryClient();
  const setUser = useAuthStore((state) => state.setUser);
  const adoptAccountPreference = useThemeStore((state) => state.adoptAccountPreference);

  return useMutation({
    mutationFn: authApi.updateMe,
    onMutate: (payload) => {
      const previous = useThemeStore.getState().preference;
      if (payload.theme !== undefined) adoptAccountPreference(payload.theme);

      return { previousTheme: previous };
    },
    onSuccess: (user) => {
      setUser(user);
      queryClient.setQueryData(queryKeys.auth.session(), user);
      adoptAccountPreference(user.theme);
      toast.success('Preferences saved');
    },
    onError: (error, _payload, context) => {
      if (context) adoptAccountPreference(context.previousTheme);
      toast.error(getErrorMessage(error, 'Your preferences could not be saved.'));
    },
  });
}

export function useChangePassword(): UseMutationResult<void, unknown, ChangePasswordPayload> {
  return useMutation({
    mutationFn: authApi.changePassword,
    onSuccess: () => {
      // Says what actually happened, because the server revoked every other
      // refresh token and a user who is signed in elsewhere will find out the
      // hard way otherwise.
      toast.success('Password changed. Other devices have been signed out.');
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Your password could not be changed.'));
    },
  });
}
