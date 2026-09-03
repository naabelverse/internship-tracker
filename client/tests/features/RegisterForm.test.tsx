import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { errorBody, makeUser, successBody } from '../utils/factories';
import { installMockApi, type MockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState } from '../utils/render';

const REFRESH = 'POST /auth/refresh';
const REGISTER = 'POST /auth/register';

const noSession: Responder = () => ({
  status: 401,
  data: errorBody('No refresh token was provided', 'MISSING_REFRESH_TOKEN'),
});

async function renderRegisterPage(routes: Record<string, Responder>): Promise<MockApi> {
  const mock = installMockApi({ [REFRESH]: noSession, ...routes });
  renderWithProviders(<App />, { route: '/register' });
  await screen.findByRole('button', { name: 'Create account' });

  return mock;
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Name'), 'Ada Lovelace');
  await user.type(screen.getByLabelText('Email'), 'ada@example.test');
  await user.type(screen.getByLabelText('Password'), 'Password1');
  await user.click(screen.getByRole('checkbox'));
}

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

describe('RegisterForm', () => {
  it('enforces the same password rules the server does', async () => {
    const user = userEvent.setup();
    const mock = await renderRegisterPage({});

    await user.type(screen.getByLabelText('Name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.test');
    await user.type(screen.getByLabelText('Password'), 'password');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Include an uppercase letter')).toBeInTheDocument();
    expect(mock.callsTo('POST', '/auth/register')).toHaveLength(0);
  });

  it('requires the terms to be accepted', async () => {
    const user = userEvent.setup();
    const mock = await renderRegisterPage({});

    await user.type(screen.getByLabelText('Name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.test');
    await user.type(screen.getByLabelText('Password'), 'Password1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('Accept the Terms and Privacy Policy to continue'),
    ).toBeInTheDocument();
    expect(mock.callsTo('POST', '/auth/register')).toHaveLength(0);
  });

  it('sends the detected timezone and the accepted terms flag', async () => {
    const user = userEvent.setup();
    const mock = await renderRegisterPage({
      [REGISTER]: () => ({
        status: 201,
        data: successBody({ user: makeUser(), accessToken: 'access-1' }),
      }),
    });

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByTestId('phase-placeholder')).toHaveAttribute('data-phase', '8');

    const body = mock.callsTo('POST', '/auth/register')[0].data as Record<string, unknown>;
    expect(body.acceptTerms).toBe(true);
    expect(typeof body.timezone).toBe('string');
    expect(body.timezone).not.toBe('');
  });

  it('puts a duplicate email conflict on the email field', async () => {
    const user = userEvent.setup();
    await renderRegisterPage({
      [REGISTER]: () => ({
        status: 409,
        data: errorBody('An account with that email already exists', 'EMAIL_IN_USE'),
      }),
    });

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('An account with that email already exists'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });
});
