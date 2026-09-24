import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { useAuthStore } from '@/store/authStore';
import { errorBody, makeUser, successBody } from '../utils/factories';
import { installMockApi, type MockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState } from '../utils/render';

/**
 * A correct password on a closed account, from the sign-in form's side: the
 * server answers 409 with a restore token, and nothing is restored until the
 * user says so in the dialog.
 */

const LOGIN = 'POST /auth/login';
const RESTORE = 'POST /auth/restore';
// Noon UTC, so the calendar date is the same in any zone the suite runs in.
const PURGE_AT = '2026-10-24T12:00:00.000Z';

const noSession: Responder = () => ({
  status: 401,
  data: errorBody('No refresh token was provided', 'MISSING_REFRESH_TOKEN'),
});

const pendingDeletion: Responder = () => ({
  status: 409,
  data: {
    success: false,
    message: 'This account is closed and scheduled for deletion.',
    code: 'ACCOUNT_PENDING_DELETION',
    errors: { purgeAt: PURGE_AT, restoreToken: 'restore-token-1' },
  },
});

const restored: Responder = () => ({
  status: 200,
  data: successBody({ user: makeUser({ name: 'Ada Lovelace' }), accessToken: 'access-restored' }),
});

async function signInToClosedAccount(routes: Record<string, Responder> = {}): Promise<MockApi> {
  const user = userEvent.setup();
  const mock = installMockApi({
    'POST /auth/refresh': noSession,
    [LOGIN]: pendingDeletion,
    ...routes,
  });
  renderWithProviders(<App />, { route: '/login' });
  await screen.findByRole('button', { name: 'Sign in' });

  await user.type(screen.getByLabelText('Email'), 'ada@example.test');
  await user.type(screen.getByLabelText('Password'), 'Password1');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  return mock;
}

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

describe('signing in to a closed account', () => {
  it('asks before restoring, naming the date the account will be deleted', async () => {
    const mock = await signInToClosedAccount({ [RESTORE]: restored });

    const dialog = await screen.findByRole('dialog', { name: 'Your account is closed' });
    expect(dialog).toHaveTextContent(
      'Your account is scheduled for deletion on 24 October 2026. Restore it?',
    );
    expect(dialog).toHaveTextContent(/won.t be sent/);

    // A question, not a failure: no error on the form and nothing restored yet.
    expect(screen.queryByText(/closed and scheduled for deletion/)).toBeNull();
    expect(mock.callsTo('POST', '/auth/restore')).toHaveLength(0);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('restores with the token from the prompt and signs the user in', async () => {
    const user = userEvent.setup();
    const mock = await signInToClosedAccount({ [RESTORE]: restored });

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Restore my account' }));

    await waitFor(() => {
      expect(useAuthStore.getState().accessToken).toBe('access-restored');
    });
    expect(mock.callsTo('POST', '/auth/restore')[0].data).toEqual({
      restoreToken: 'restore-token-1',
    });
    expect(await screen.findByText('Skip to main content')).toBeInTheDocument();
  });

  it('leaves the account closed and clears the password on "Keep it closed"', async () => {
    const user = userEvent.setup();
    const mock = await signInToClosedAccount({ [RESTORE]: restored });

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Keep it closed' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(mock.callsTo('POST', '/auth/restore')).toHaveLength(0);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('treats Escape as "Keep it closed"', async () => {
    const user = userEvent.setup();
    const mock = await signInToClosedAccount({ [RESTORE]: restored });

    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(mock.callsTo('POST', '/auth/restore')).toHaveLength(0);
  });

  it('says why when a restore is refused, next to the form', async () => {
    const user = userEvent.setup();
    await signInToClosedAccount({
      [RESTORE]: () => ({
        status: 400,
        data: errorBody(
          'This restore request has expired. Sign in again to restore the account.',
          'TOKEN_EXPIRED',
        ),
      }),
    });

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Restore my account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This restore request has expired');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('shows the 410 message inline once the restore window has ended', async () => {
    await signInToClosedAccount({
      [LOGIN]: () => ({
        status: 410,
        data: errorBody(
          'This account was closed more than 30 days ago and can no longer be restored.',
          'ACCOUNT_PURGED',
        ),
      }),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This account was closed more than 30 days ago and can no longer be restored.',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
