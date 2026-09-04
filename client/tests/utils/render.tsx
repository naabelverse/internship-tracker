import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, type RenderResult } from '@testing-library/react';
import { apiClient } from '@/api/client';
import { authClient } from '@/api/http';
import { resetRefreshState } from '@/api/refresh';
import { ROUTER_FUTURE } from '@/routes/routerFuture';
import { useAuthStore } from '@/store/authStore';
import type { AuthSession } from '@/types/user';

/** Retries and caching would hide the very ordering these tests assert on. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

interface RenderOptions {
  route?: string;
  /**
   * Supply the client when the test needs to drive the cache itself — removing a
   * query to force a component into its loading branch, for instance, which is
   * how the board's unmount-mid-mutation case is reproduced without leaning on
   * timing. Omit it and each render gets its own fresh client, as before.
   */
  queryClient?: QueryClient;
}

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', queryClient = createTestQueryClient() }: RenderOptions = {},
): RenderResult {
  function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]} future={ROUTER_FUTURE}>
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper });
}

/**
 * Puts every module-level singleton back to its cold-start state between cases.
 * Unmounting first matters: the store, the axios adapter and the refresh slot are
 * module-level and shared within a file, so resetting them under a live tree
 * schedules renders outside `act` and lets one case perturb the next.
 */
export function resetClientState(): void {
  cleanup();
  resetRefreshState();
  useAuthStore.setState({ accessToken: null, user: null, status: 'pending' });
  apiClient.defaults.adapter = undefined;
  authClient.defaults.adapter = undefined;
  window.localStorage.clear();
  window.sessionStorage.clear();
}

/** Marks the store as already signed in, skipping the cold-start bootstrap. */
export function signIn(session: AuthSession): void {
  useAuthStore.setState({
    accessToken: session.accessToken,
    user: session.user,
    status: 'authenticated',
  });
}
