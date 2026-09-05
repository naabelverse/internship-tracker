import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { errorBody, makeEmptySummary, makeUser, successBody } from '../utils/factories';
import { installMockApi, type MockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState } from '../utils/render';

const REFRESH = 'POST /auth/refresh';
const REGISTER = 'POST /auth/register';

const noSession: Responder = () => ({
  status: 401,
  data: errorBody('No refresh token was provided', 'MISSING_REFRESH_TOKEN'),
});

const dashboardRoutes: Record<string, Responder> = {
  'GET /analytics/summary': () => ({ status: 200, data: successBody(makeEmptySummary()) }),
  'GET /analytics/status-breakdown': () => ({ status: 200, data: successBody({ breakdown: [] }) }),
  'GET /analytics/timeline': () => ({
    status: 200,
    data: successBody({ granularity: 'day', range: '90d', points: [] }),
  }),
  'GET /analytics/by-source': () => ({ status: 200, data: successBody({ sources: [] }) }),
  'GET /analytics/funnel': () => ({ status: 200, data: successBody({ stages: [] }) }),
  'GET /analytics/top-companies': () => ({ status: 200, data: successBody({ companies: [] }) }),
  'GET /calendar': () => ({ status: 200, data: successBody({ events: [] }) }),
};

const accepted: Responder = () => ({
  status: 201,
  data: successBody({ user: makeUser(), accessToken: 'fresh-access-token' }),
});

async function renderRegisterPage(routes: Record<string, Responder> = {}): Promise<MockApi> {
  const mock = installMockApi({ [REFRESH]: noSession, [REGISTER]: accepted, ...routes });
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

/** The honeypot has no label, by design, so it is found by its name attribute. */
function honeypot(): HTMLInputElement {
  const field = document.querySelector('input[name="website"]');

  if (!(field instanceof HTMLInputElement)) throw new Error('Honeypot field is not rendered');

  return field;
}

/** Submits a filled form and returns the body that reached the API. */
async function submitAndReadBody(mock: MockApi): Promise<Record<string, unknown>> {
  await waitFor(() => {
    expect(mock.callsTo('POST', '/auth/register')).toHaveLength(1);
  });

  return mock.callsTo('POST', '/auth/register')[0].data as Record<string, unknown>;
}

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

describe('the registration honeypot', () => {
  it('is rendered, empty, so something filling fields by name fills it', async () => {
    await renderRegisterPage();

    expect(honeypot().value).toBe('');
  });

  it('is kept away from anyone actually using the form', async () => {
    await renderRegisterPage();

    const field = honeypot();

    // Not reachable by tab, not announced, and not autofillable - the three ways
    // a real person could end up with a value in it.
    expect(field.tabIndex).toBe(-1);
    expect(field.getAttribute('aria-hidden')).toBe('true');
    expect(field.getAttribute('autocomplete')).toBe('off');
  });

  it('is positioned out of view rather than display none, which fillers skip', async () => {
    await renderRegisterPage();

    const style = honeypot().style;

    expect(style.display).not.toBe('none');
    expect(style.position).toBe('absolute');
    expect(style.width).toBe('1px');
  });

  it('has no label, so it is invisible to a screen reader as well as a mouse', async () => {
    await renderRegisterPage();

    expect(screen.queryByLabelText(/website/i)).not.toBeInTheDocument();
  });
});

describe('what the form sends', () => {
  it('sends the honeypot empty and a real elapsed time', async () => {
    const user = userEvent.setup();
    const mock = await renderRegisterPage(dashboardRoutes);

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    const body = await submitAndReadBody(mock);

    expect(body.website).toBe('');
    expect(typeof body.elapsedMs).toBe('number');
  });

  it('measures from the form mounting, not from the click', async () => {
    const user = userEvent.setup();
    const mock = await renderRegisterPage(dashboardRoutes);

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    const body = await submitAndReadBody(mock);

    // Typing three fields and ticking a box takes real time under user-event, so
    // a zero here would mean the clock started at submit rather than at mount.
    expect(body.elapsedMs).toBeGreaterThan(0);
  });

  it('still carries everything registration needed before the honeypot existed', async () => {
    const user = userEvent.setup();
    const mock = await renderRegisterPage(dashboardRoutes);

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await submitAndReadBody(mock)).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.test',
      password: 'Password1',
      acceptTerms: true,
    });
  });
});

describe('a rejected sign-up', () => {
  it('shows the server message and leaves the form usable', async () => {
    const user = userEvent.setup();

    await renderRegisterPage({
      [REGISTER]: () => ({
        status: 400,
        data: errorBody(
          'That sign-up looked automated. Wait a moment and try again.',
          'SIGNUP_REJECTED',
        ),
      }),
    });

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/looked automated/i);
    // Recoverable: the values are still there and the button still works.
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.test');
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });

  it('reports a disposable address in a way the user can act on', async () => {
    const user = userEvent.setup();

    await renderRegisterPage({
      [REGISTER]: () => ({
        status: 400,
        data: errorBody(
          'That looks like a disposable email address. Please sign up with an address you can receive mail at.',
          'DISPOSABLE_EMAIL',
        ),
      }),
    });

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/disposable email address/i);
  });
});
