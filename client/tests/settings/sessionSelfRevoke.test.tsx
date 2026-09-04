import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { useAuthStore } from '@/store/authStore';
import { makeSession, makeUser } from '../utils/factories';
import { installMockApi, type MockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

/**
 * Revoking your own session has to do more than call the endpoint: the moment
 * the server drops that refresh token the local access token is dead, so the
 * client must clear its own state and get out rather than sit there holding a
 * token that can never rotate again.
 *
 * Which row is "mine" is decided server-side, by hashing the refresh cookie the
 * request arrived with - `current` on the row. The client never guesses.
 */

const SESSIONS = 'GET /auth/sessions';
const user = makeUser({ emailVerified: true });

const thisDevice = {
  id: 'session-mine',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
  ip: '203.0.113.7',
  lastUsedAt: '2026-09-04T10:00:00.000Z',
  createdAt: '2026-09-01T10:00:00.000Z',
  expiresAt: '2026-10-01T10:00:00.000Z',
  current: true,
};

const otherDevice = {
  ...thisDevice,
  id: 'session-other',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605.1',
  ip: '198.51.100.4',
  current: false,
};

const sessionList: Responder = () => ({
  status: 200,
  data: { success: true, data: { sessions: [thisDevice, otherDevice] } },
});

function renderSettings(routes: Record<string, Responder> = {}): MockApi {
  const mock = installMockApi({
    'GET /auth/me': () => ({ status: 200, data: { success: true, data: { user } } }),
    [SESSIONS]: sessionList,
    ...routes,
  });
  signIn(makeSession({ user }));
  renderWithProviders(<App />, { route: '/settings' });

  return mock;
}

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

/** The list row the UI has labelled as this device. */
async function currentRow(): Promise<HTMLElement> {
  const marker = await screen.findByText('This device');
  const row = marker.closest('li');

  if (!row) throw new Error('The current session is not in a list row');

  return row;
}

describe('revoking the current session', () => {
  it('clears client auth state and redirects to sign in', async () => {
    const userEvents = userEvent.setup();
    const mock = renderSettings({
      'DELETE /auth/sessions/session-mine': () => ({
        status: 200,
        data: { success: true, data: { revoked: true } },
      }),
    });

    const row = await currentRow();
    expect(useAuthStore.getState().accessToken).not.toBeNull();

    await userEvents.click(within(row).getByRole('button', { name: 'Sign out this device' }));

    await waitFor(() => {
      expect(mock.callsTo('DELETE', '/auth/sessions/session-mine')).toHaveLength(1);
    });

    // The three things that actually matter, none of which is the API call.
    await waitFor(() => {
      expect(useAuthStore.getState().accessToken).toBeNull();
    });
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().status).toBe('anonymous');

    await screen.findByRole('heading', { name: 'Sign in' });
  });

  it('leaves the session alone when another device is revoked', async () => {
    const userEvents = userEvent.setup();
    const mock = renderSettings({
      'DELETE /auth/sessions/session-other': () => ({
        status: 200,
        data: { success: true, data: { revoked: true } },
      }),
    });

    await screen.findByText('This device');
    await userEvents.click(
      screen.getByRole('button', { name: /^Sign out Safari on iOS at 198\.51\.100\.4$/ }),
    );

    await waitFor(() => {
      expect(mock.callsTo('DELETE', '/auth/sessions/session-other')).toHaveLength(1);
    });

    // Still signed in, still on Settings.
    expect(useAuthStore.getState().accessToken).not.toBeNull();
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('signs out locally when signing out everywhere', async () => {
    const userEvents = userEvent.setup();
    const mock = renderSettings({
      'POST /auth/logout-all': () => ({
        status: 200,
        data: { success: true, data: { revokedSessions: 2 } },
      }),
    });

    await screen.findByText('This device');
    await userEvents.click(screen.getByRole('button', { name: 'Sign out everywhere' }));

    await waitFor(() => {
      expect(mock.callsTo('POST', '/auth/logout-all')).toHaveLength(1);
    });

    await waitFor(() => {
      expect(useAuthStore.getState().accessToken).toBeNull();
    });
    await screen.findByRole('heading', { name: 'Sign in' });
  });
});
