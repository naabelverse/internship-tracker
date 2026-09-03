import { authClient } from '@/api/http';
import { clearAuthState, useAuthStore } from '@/store/authStore';
import type { ApiSuccessBody } from '@/types/api';

interface RefreshData {
  accessToken: string;
}

/**
 * The one in-flight refresh, or null when none is running.
 *
 * This single shared promise *is* the request queue. Every caller that needs a
 * fresh token awaits the same promise, so the continuations parked on it are the
 * queued requests and the settlement of one `POST /auth/refresh` response is what
 * releases them all. An explicit array of deferreds would carry the same
 * semantics with more bookkeeping and one extra failure mode: a subscriber
 * enqueued but never drained if the refresh throws somewhere unexpected. A
 * promise cannot leave its continuations pending.
 */
let inFlight: Promise<string> | null = null;

async function performRefresh(): Promise<string> {
  try {
    const { data } = await authClient.post<ApiSuccessBody<RefreshData>>('/auth/refresh');
    const { accessToken } = data.data;

    useAuthStore.getState().setAccessToken(accessToken);
    return accessToken;
  } catch (error) {
    // The cookie is dead. Dropping the in-memory session here — rather than only
    // in the caller — means a failed cold-start refresh and a failed mid-session
    // refresh both leave the same state behind.
    clearAuthState();
    throw error;
  }
}

/**
 * Resolves with a valid access token, refreshing at most once no matter how many
 * callers arrive while a refresh is in flight.
 *
 * The assignment to `inFlight` happens synchronously before the promise is
 * returned, so a caller that arrives in a later microtask always sees the
 * existing attempt instead of starting a second one.
 */
export function ensureFreshToken(): Promise<string> {
  if (inFlight !== null) return inFlight;

  inFlight = performRefresh().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Test seam: drops any in-flight refresh so cases cannot leak into each other. */
export function resetRefreshState(): void {
  inFlight = null;
}
