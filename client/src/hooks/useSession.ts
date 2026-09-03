import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMe } from '@/api/auth';
import { queryKeys } from '@/api/queryKeys';
import { ensureFreshToken } from '@/api/refresh';
import { useAuthStore } from '@/store/authStore';
import type { SessionStatus } from '@/store/authStore';
import type { User } from '@/types/user';

/**
 * Restores a session on a cold page load. The access token is memory-only, so
 * after a refresh of the browser the only evidence of a session is the httpOnly
 * cookie — exchange it for a token, then read the user it belongs to.
 */
async function loadSession(): Promise<User> {
  await ensureFreshToken();
  return fetchMe();
}

/**
 * Runs the cold-start session restore exactly once, at the app root. A failure
 * is not an error state: it simply means nobody is signed in, so the store moves
 * to `anonymous` and the router sends protected routes to /login. The refresh
 * coordinator has already cleared any partial state by then.
 */
export function useSessionBootstrap(): void {
  const status = useAuthStore((state) => state.status);
  const setUser = useAuthStore((state) => state.setUser);
  const clear = useAuthStore((state) => state.clear);

  const { data, isError } = useQuery({
    queryKey: queryKeys.auth.session(),
    queryFn: loadSession,
    enabled: status === 'pending',
    retry: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (data) setUser(data);
  }, [data, setUser]);

  useEffect(() => {
    if (isError) clear();
  }, [isError, clear]);
}

interface Session {
  status: SessionStatus;
  user: User | null;
  isAuthenticated: boolean;
}

/** Reads the resolved session. Never triggers a request itself. */
export function useSession(): Session {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);

  return { status, user, isAuthenticated: status === 'authenticated' };
}
