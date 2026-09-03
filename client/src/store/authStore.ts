import { create } from 'zustand';
import type { AuthSession, User } from '@/types/user';

/**
 * `pending` is the state on a cold page load, before the silent refresh has said
 * whether the httpOnly cookie is still good. Protected routes must wait it out
 * rather than treating it as anonymous, or every hard refresh would bounce a
 * signed-in user to /login.
 */
export type SessionStatus = 'pending' | 'authenticated' | 'anonymous';

interface AuthState {
  /**
   * SPEC section 7: the access token lives in memory only. It is deliberately
   * never persisted, so nothing here may be wrapped in zustand's `persist`.
   */
  accessToken: string | null;
  user: User | null;
  status: SessionStatus;
  setSession: (session: AuthSession) => void;
  setAccessToken: (accessToken: string) => void;
  setUser: (user: User) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  status: 'pending',
  setSession: ({ user, accessToken }) => {
    set({ user, accessToken, status: 'authenticated' });
  },
  setAccessToken: (accessToken) => {
    set({ accessToken });
  },
  setUser: (user) => {
    set({ user, status: 'authenticated' });
  },
  clear: () => {
    set({ accessToken: null, user: null, status: 'anonymous' });
  },
}));

/** Synchronous read for non-React callers such as the axios interceptors. */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}

/** Drops every trace of the session. Used by logout and by a failed refresh. */
export function clearAuthState(): void {
  useAuthStore.getState().clear();
}
