import { QueryClient } from '@tanstack/react-query';
import { getApiError } from '@/api/errors';

/** A 4xx is the server's final answer; only transport and 5xx failures are retried. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  const apiError = getApiError(error);
  if (apiError !== null) return false;

  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
