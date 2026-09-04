import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { useAuthStore } from '@/store/authStore';
import { errorBody, makeUser, successBody } from '../utils/factories';
import { installMockApi, type MockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState } from '../utils/render';

const REFRESH = 'POST /auth/refresh';
const LOGIN = 'POST /auth/login';

const noSession: Responder = () => ({
  status: 401,
  data: errorBody('No refresh token was provided', 'MISSING_REFRESH_TOKEN'),
});

async function renderLoginPage(
  routes: Record<string, Responder>,
  route = '/login',
): Promise<MockApi> {
  const mock = installMockApi({ [REFRESH]: noSession, ...routes });
  renderWithProviders(<App />, { route });
  await screen.findByRole('button', { name: 'Sign in' });

  return mock;
}

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

describe('LoginForm', () => {
  it('validates before sending anything to the server', async () => {
    const user = userEvent.setup();
    const mock = await renderLoginPage({});

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter your email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(mock.callsTo('POST', '/auth/login')).toHaveLength(0);
  });

  it('signs in and lands on the page the user was sent away from', async () => {
    const user = userEvent.setup();
    const session = { user: makeUser(), accessToken: 'access-1' };

    await renderLoginPage(
      { [LOGIN]: () => ({ status: 200, data: successBody(session) }) },
      '/settings',
    );

    await user.type(screen.getByLabelText('Email'), 'ada@example.test');
    await user.type(screen.getByLabelText('Password'), 'Password1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(useAuthStore.getState().accessToken).toBe('access-1');
  });

  it('shows a form-level message when the credentials are rejected', async () => {
    const user = userEvent.setup();
    await renderLoginPage({
      [LOGIN]: () => ({
        status: 401,
        data: errorBody('Email or password is incorrect', 'INVALID_CREDENTIALS'),
      }),
    });

    await user.type(screen.getByLabelText('Email'), 'ada@example.test');
    await user.type(screen.getByLabelText('Password'), 'Password1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('maps a server field error onto the field it belongs to', async () => {
    const user = userEvent.setup();
    await renderLoginPage({
      [LOGIN]: () => ({
        status: 400,
        data: errorBody('Validation failed', 'VALIDATION_ERROR', {
          email: ['must be a valid email address'],
        }),
      }),
    });

    await user.type(screen.getByLabelText('Email'), 'ada@example.test');
    await user.type(screen.getByLabelText('Password'), 'Password1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Must be a valid email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('reveals and hides the password', async () => {
    const user = userEvent.setup();
    await renderLoginPage({});

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });
});
