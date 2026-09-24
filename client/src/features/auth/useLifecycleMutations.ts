import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import * as authApi from '@/api/auth';
import type { ActiveSession } from '@/api/auth';
import { getErrorMessage } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { paths } from '@/routes/paths';
import { clearAuthState } from '@/store/authStore';

export function useResendVerification(): UseMutationResult<void, unknown, void> {
  return useMutation({
    mutationFn: authApi.resendVerification,
    onSuccess: () => {
      toast.success('Check your inbox for a new confirmation link.');
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'That link could not be sent. Try again shortly.'));
    },
  });
}

export function useSessions(): UseQueryResult<ActiveSession[]> {
  return useQuery({
    queryKey: queryKeys.auth.sessions(),
    queryFn: authApi.fetchSessions,
  });
}

/**
 * Signing out a device.
 *
 * Revoking your own session is a real and reasonable thing to do from a list
 * that names it "this device", and the server will happily do it. `current`
 * comes from the server, which compares the refresh token hash the request
 * arrived with against each row - the client never guesses. When that is the row
 * being revoked, the local session is already dead the moment the call returns,
 * so the store is cleared and the user is sent to /login rather than being left
 * holding an access token whose refresh cookie can no longer rotate.
 */
export function useRevokeSession(): UseMutationResult<void, unknown, ActiveSession> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (session: ActiveSession) => authApi.revokeSession(session.id),
    onSuccess: (_result, session) => {
      if (session.current) {
        clearAuthState();
        toast.success('Signed out on this device.');
        void navigate(paths.login, { replace: true });
        return;
      }

      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.sessions() });
      toast.success('That device has been signed out.');
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'That device could not be signed out.'));
    },
  });
}

/** Revokes every token, this one included, so it always ends in a sign-out. */
export function useLogoutEverywhere(): UseMutationResult<void, unknown, void> {
  const navigate = useNavigate();

  return useMutation({
    mutationFn: authApi.logoutEverywhere,
    onSuccess: () => {
      clearAuthState();
      toast.success('Signed out on every device.');
      void navigate(paths.login, { replace: true });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Those devices could not be signed out.'));
    },
  });
}

export function useDeleteAccount(): UseMutationResult<string, unknown, string> {
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (password: string) => authApi.deleteAccount(password),
    onSuccess: (purgeAt) => {
      // Deliberately no `clearAuthState()` here. Clearing it now would make
      // `ProtectedRoute` redirect to /login from the route we are still on,
      // before this navigation commits. `AccountClosedPage` clears it on mount,
      // which cannot happen before the page it belongs to is the page showing.
      // The purge date rides in route state so that page can name the deadline.
      void navigate(paths.accountClosed, { replace: true, state: { purgeAt } });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Your account could not be closed.'));
    },
  });
}
