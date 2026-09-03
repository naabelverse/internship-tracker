import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/api/client';
import { browserNavigation } from '@/lib/redirect';
import { useAuthStore } from '@/store/authStore';
import { errorBody, makeSession, successBody } from '../utils/factories';
import { createGate, installMockApi, type Responder } from '../utils/mockAdapter';
import { resetClientState, signIn } from '../utils/render';

const STALE = 'stale-access-token';
const FRESH = 'fresh-access-token';

const REFRESH = 'POST /auth/refresh';

/** Answers 200 only for the rotated token, exactly as the API would. */
const protectedRoute: Responder = ({ authorization }) =>
  authorization === `Bearer ${FRESH}`
    ? { status: 200, data: successBody({ ok: true }) }
    : { status: 401, data: errorBody('Access token has expired', 'ACCESS_TOKEN_EXPIRED') };

const grantsFreshToken: Responder = () => ({
  status: 200,
  data: successBody({ accessToken: FRESH }),
});

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetClientState();
});

describe('401 handling', () => {
  it('refreshes once for concurrent 401s and replays every queued request', async () => {
    const gate = createGate();
    const mock = installMockApi({
      'GET /applications': protectedRoute,
      'GET /analytics/summary': protectedRoute,
      'GET /reminders': protectedRoute,
      [REFRESH]: async () => {
        // Held open so all three 401s are provably in the queue at the same time.
        await gate.wait;
        return { status: 200, data: successBody({ accessToken: FRESH }) };
      },
    });

    signIn(makeSession({ accessToken: STALE }));

    const pending = Promise.all([
      apiClient.get('/applications'),
      apiClient.get('/analytics/summary'),
      apiClient.get('/reminders'),
    ]);

    await vi.waitFor(() => {
      expect(mock.callsTo('GET', '/applications')).toHaveLength(1);
      expect(mock.callsTo('GET', '/analytics/summary')).toHaveLength(1);
      expect(mock.callsTo('GET', '/reminders')).toHaveLength(1);
      expect(mock.callsTo('POST', '/auth/refresh')).toHaveLength(1);
    });

    gate.open();
    const responses = await pending;

    // The assertion the whole phase turns on: one refresh, not one per request.
    expect(mock.callsTo('POST', '/auth/refresh')).toHaveLength(1);

    for (const url of ['/applications', '/analytics/summary', '/reminders']) {
      const attempts = mock.callsTo('GET', url);
      expect(attempts).toHaveLength(2);
      expect(attempts[0].authorization).toBe(`Bearer ${STALE}`);
      expect(attempts[1].authorization).toBe(`Bearer ${FRESH}`);
    }

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(useAuthStore.getState().accessToken).toBe(FRESH);
  });

  it('never writes the access token to browser storage', async () => {
    installMockApi({ 'GET /applications': protectedRoute, [REFRESH]: grantsFreshToken });
    signIn(makeSession({ accessToken: STALE }));

    await apiClient.get('/applications');

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('replays a single 401 exactly once with the rotated token', async () => {
    const mock = installMockApi({
      'GET /applications': protectedRoute,
      [REFRESH]: grantsFreshToken,
    });
    signIn(makeSession({ accessToken: STALE }));

    const response = await apiClient.get('/applications');

    expect(response.status).toBe(200);
    expect(mock.callsTo('POST', '/auth/refresh')).toHaveLength(1);
    expect(mock.callsTo('GET', '/applications')).toHaveLength(2);
  });

  it('does not refresh a second time when a 401 lands after another request rotated the token', async () => {
    const slow = createGate();
    let slowAttempts = 0;

    const mock = installMockApi({
      'GET /fast': protectedRoute,
      'GET /slow': async (request) => {
        slowAttempts += 1;
        // The first attempt is held past the point where the refresh has already
        // finished and the single-flight slot has been cleared.
        if (slowAttempts === 1) {
          await slow.wait;
          return {
            status: 401,
            data: errorBody('Access token has expired', 'ACCESS_TOKEN_EXPIRED'),
          };
        }
        return protectedRoute(request);
      },
      [REFRESH]: grantsFreshToken,
    });

    signIn(makeSession({ accessToken: STALE }));

    const slowRequest = apiClient.get('/slow');
    const fastResponse = await apiClient.get('/fast');
    expect(fastResponse.status).toBe(200);
    expect(useAuthStore.getState().accessToken).toBe(FRESH);

    slow.open();
    const response = await slowRequest;

    expect(response.status).toBe(200);
    expect(mock.callsTo('GET', '/slow')).toHaveLength(2);
    expect(mock.callsTo('GET', '/slow')[1].authorization).toBe(`Bearer ${FRESH}`);
    // Still one: the late 401 saw a token it had not used and simply replayed.
    expect(mock.callsTo('POST', '/auth/refresh')).toHaveLength(1);
  });

  it('gives up instead of looping when the replayed request is still rejected', async () => {
    const mock = installMockApi({
      'GET /applications': () => ({
        status: 401,
        data: errorBody('Access token has expired', 'ACCESS_TOKEN_EXPIRED'),
      }),
      [REFRESH]: grantsFreshToken,
    });

    signIn(makeSession({ accessToken: STALE }));

    await expect(apiClient.get('/applications')).rejects.toMatchObject({
      response: { status: 401 },
    });

    expect(mock.callsTo('GET', '/applications')).toHaveLength(2);
    expect(mock.callsTo('POST', '/auth/refresh')).toHaveLength(1);
  });

  it('clears the session and hard-redirects once when the refresh itself fails', async () => {
    const hardRedirect = vi
      .spyOn(browserNavigation, 'hardRedirect')
      .mockImplementation(() => undefined);

    const mock = installMockApi({
      'GET /applications': protectedRoute,
      [REFRESH]: () => ({
        status: 401,
        data: errorBody('Refresh token is not valid', 'INVALID_REFRESH_TOKEN'),
      }),
    });

    signIn(makeSession({ accessToken: STALE }));

    await expect(apiClient.get('/applications')).rejects.toMatchObject({
      response: { status: 401 },
    });

    expect(mock.callsTo('POST', '/auth/refresh')).toHaveLength(1);
    expect(hardRedirect).toHaveBeenCalledTimes(1);
    expect(hardRedirect).toHaveBeenCalledWith('/login');
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().status).toBe('anonymous');
  });

  it('propagates a non-401 failure untouched', async () => {
    const mock = installMockApi({
      'GET /applications': () => ({
        status: 500,
        data: errorBody('Something went wrong on our end', 'INTERNAL_ERROR'),
      }),
      [REFRESH]: grantsFreshToken,
    });

    signIn(makeSession({ accessToken: STALE }));

    await expect(apiClient.get('/applications')).rejects.toMatchObject({
      response: { status: 500 },
    });
    expect(mock.callsTo('POST', '/auth/refresh')).toHaveLength(0);
  });
});
