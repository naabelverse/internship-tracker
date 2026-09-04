import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import * as authApi from '@/api/auth';
import { getErrorMessage } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { paths } from '@/routes/paths';
import { clearAuthState, useAuthStore } from '@/store/authStore';
import type { AuthSession } from '@/types/user';

/**
 * Shared success path for register and login: put the session in memory, seed the
 * session query so the cold-start bootstrap does not run a second time, and land
 * the user where they were headed before they were bounced to /login.
 */
function useSessionEstablished(): (session: AuthSession, redirectTo: string) => void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);

  return (session, redirectTo) => {
    setSession(session);
    queryClient.setQueryData(queryKeys.auth.session(), session.user);
    navigate(redirectTo, { replace: true });
  };
}

export function useLogin(
  redirectTo: string,
): UseMutationResult<AuthSession, unknown, authApi.LoginPayload> {
  const onEstablished = useSessionEstablished();

  return useMutation({
    mutationFn: authApi.login,
    onSuccess: (session) => {
      onEstablished(session, redirectTo);
      toast.success(`Welcome back, ${session.user.name.split(' ')[0]}`);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Could not sign you in'));
    },
  });
}

/**
 * "Try the demo" on the landing page. Takes no arguments, mirroring the endpoint.
 * The toast sets expectations up front: the account is shared and resets nightly,
 * which is why the destructive actions inside it answer with a refusal.
 */
export function useDemoLogin(): UseMutationResult<AuthSession, unknown, void> {
  const onEstablished = useSessionEstablished();

  return useMutation({
    mutationFn: authApi.demoLogin,
    onSuccess: (session) => {
      onEstablished(session, paths.dashboard);
      toast.success('You are in the demo account. It is shared, and resets every night.');
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'The demo is not available right now'));
    },
  });
}

export function useRegister(
  redirectTo: string,
): UseMutationResult<AuthSession, unknown, authApi.RegisterPayload> {
  const onEstablished = useSessionEstablished();

  return useMutation({
    mutationFn: authApi.register,
    onSuccess: (session) => {
      onEstablished(session, redirectTo);
      toast.success('Account created');
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Could not create your account'));
    },
  });
}

export function useLogout(): UseMutationResult<void, unknown, void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      toast.success('Signed out');
    },
    onError: (error) => {
      // The local session is dropped either way below: a user who asked to sign
      // out must not stay signed in because the network was down.
      toast.error(getErrorMessage(error, 'Signed out locally, but the server did not confirm'));
    },
    onSettled: () => {
      clearAuthState();
      queryClient.clear();
      navigate(paths.login, { replace: true });
    },
  });
}
