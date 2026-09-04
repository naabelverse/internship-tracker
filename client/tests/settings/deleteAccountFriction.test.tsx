import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { useAuthStore } from '@/store/authStore';
import { makeSession, makeUser } from '../utils/factories';
import { installMockApi, type MockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

/**
 * Closing an account starts a 30 day clock on real data and there is no
 * un-delete endpoint anywhere in the API, so the destructive call must not be
 * reachable by one click. These cases assert the gates hold rather than merely
 * that they are rendered.
 */

const user = makeUser({ emailVerified: true });

function renderSettings(routes: Record<string, Responder> = {}): MockApi {
  const mock = installMockApi({
    'GET /auth/me': () => ({ status: 200, data: { success: true, data: { user } } }),
    'GET /auth/sessions': () => ({ status: 200, data: { success: true, data: { sessions: [] } } }),
    ...routes,
  });
  signIn(makeSession({ user }));
  renderWithProviders(<App />, { route: '/settings' });

  return mock;
}

const accepted: Responder = () => ({
  status: 200,
  data: { success: true, data: { deleted: true } },
});

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

describe('closing an account cannot happen by accident', () => {
  it('does not call the API when the opening button is clicked', async () => {
    const userEvents = userEvent.setup();
    const mock = renderSettings({ 'DELETE /auth/me': accepted });

    await userEvents.click(await screen.findByRole('button', { name: 'Close my account' }));

    // The first click only reveals the confirmation, it does not delete.
    expect(mock.callsTo('DELETE', '/auth/me')).toHaveLength(0);
    expect(screen.getByLabelText('Your password')).toBeInTheDocument();
  });

  it('refuses to submit without both the password and the typed word', async () => {
    const userEvents = userEvent.setup();
    const mock = renderSettings({ 'DELETE /auth/me': accepted });

    await userEvents.click(await screen.findByRole('button', { name: 'Close my account' }));
    const confirm = screen.getByRole('button', { name: 'Close my account permanently' });

    // Nothing filled in.
    await userEvents.click(confirm);
    expect(mock.callsTo('DELETE', '/auth/me')).toHaveLength(0);

    // Password only.
    await userEvents.type(screen.getByLabelText('Your password'), 'Correct1Password');
    await userEvents.click(confirm);
    await screen.findByText('You must type DELETE exactly, in capitals');
    expect(mock.callsTo('DELETE', '/auth/me')).toHaveLength(0);

    // The wrong word.
    await userEvents.type(screen.getByLabelText('Type DELETE to confirm'), 'delete');
    await userEvents.click(confirm);
    expect(mock.callsTo('DELETE', '/auth/me')).toHaveLength(0);
  });

  it('goes through once both gates are satisfied, then clears the session', async () => {
    const userEvents = userEvent.setup();
    const mock = renderSettings({ 'DELETE /auth/me': accepted });

    await userEvents.click(await screen.findByRole('button', { name: 'Close my account' }));
    await userEvents.type(screen.getByLabelText('Your password'), 'Correct1Password');

    const typed = screen.getByLabelText('Type DELETE to confirm');
    await userEvents.clear(typed);
    await userEvents.type(typed, 'DELETE');

    await userEvents.click(screen.getByRole('button', { name: 'Close my account permanently' }));

    await waitFor(() => {
      expect(mock.callsTo('DELETE', '/auth/me')).toHaveLength(1);
    });
    expect(mock.callsTo('DELETE', '/auth/me')[0].data).toEqual({ password: 'Correct1Password' });

    await waitFor(() => {
      expect(useAuthStore.getState().accessToken).toBeNull();
    });
    expect(useAuthStore.getState().status).toBe('anonymous');

    // The closed-account page, not /login: signing in again will not work.
    await screen.findByRole('heading', { name: 'Your account is closed' });
  });

  it('does not promise a recovery the API cannot deliver', async () => {
    const userEvents = userEvent.setup();
    renderSettings({ 'DELETE /auth/me': accepted });

    await userEvents.click(await screen.findByRole('button', { name: 'Close my account' }));
    await userEvents.type(screen.getByLabelText('Your password'), 'Correct1Password');

    const typed = screen.getByLabelText('Type DELETE to confirm');
    await userEvents.clear(typed);
    await userEvents.type(typed, 'DELETE');
    await userEvents.click(screen.getByRole('button', { name: 'Close my account permanently' }));

    const heading = await screen.findByRole('heading', { name: 'Your account is closed' });
    const page = heading.closest('div')?.parentElement?.textContent ?? '';

    // `login` filters `deletedAt: null`, so signing back in is not a route home.
    expect(page).not.toMatch(/sign (back )?in to (restore|reactivate|recover)/i);
    expect(page).toMatch(/contact support/i);
  });
});
