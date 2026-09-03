import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { App } from '@/App';
import { readRedirectTarget } from '@/routes/redirectTarget';
import {
  errorBody,
  makeApplication,
  makeListResponse,
  makeSession,
  makeUser,
  successBody,
} from '../utils/factories';
import { createGate, installMockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

const REFRESH = 'POST /auth/refresh';
const ME = 'GET /auth/me';
const LIST_ROUTE = 'GET /applications';
const DETAIL_ROUTE = 'GET /applications/64b7f0c2c1a4d9e5f2a10001';

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

describe('protected routing', () => {
  it('holds a skeleton while the cold-start session restore is still unresolved', () => {
    const gate = createGate();
    installMockApi({
      [REFRESH]: async () => {
        await gate.wait;
        return { status: 200, data: successBody({ accessToken: 'fresh' }) };
      },
    });

    renderWithProviders(<App />, { route: '/applications' });

    expect(screen.getByTestId('route-skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    gate.open();
  });

  it('redirects to /login when there is no session to restore', async () => {
    installMockApi({
      [REFRESH]: () => ({
        status: 401,
        data: errorBody('No refresh token was provided', 'MISSING_REFRESH_TOKEN'),
      }),
    });

    renderWithProviders(<App />, { route: '/applications' });

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByTestId('phase-placeholder')).not.toBeInTheDocument();
  });

  it('restores the session from the refresh cookie and renders the protected route', async () => {
    const user = makeUser({ name: 'Grace Hopper' });
    installMockApi({
      [REFRESH]: () => ({ status: 200, data: successBody({ accessToken: 'fresh' }) }),
      [ME]: () => ({ status: 200, data: successBody({ user }) }),
      [LIST_ROUTE]: () => ({ status: 200, data: makeListResponse([]) }),
    });

    renderWithProviders(<App />, { route: '/applications' });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Applications' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
  });

  // Phase 6 replaced the Applications and Detail placeholders and Phase 7 the
  // Board and Calendar ones, so those paths are covered by their own suites. The
  // rest still assert the placeholder contract their phases will retire in turn.
  it.each([
    ['/', '8', 'Dashboard'],
    ['/settings', '9', 'Settings'],
  ])('renders the %s route for a signed-in user', async (route, phase, heading) => {
    installMockApi({});
    signIn(makeSession());

    renderWithProviders(<App />, { route });

    const placeholder = await screen.findByTestId('phase-placeholder');
    expect(placeholder).toHaveAttribute('data-phase', phase);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it.each([
    ['/applications', 'Applications'],
    ['/applications/64b7f0c2c1a4d9e5f2a10001', 'Stripe'],
    ['/applications/board', 'Board'],
    ['/applications/calendar', 'Calendar'],
  ])('renders the real %s page for a signed-in user', async (route, heading) => {
    const application = makeApplication({ company: 'Stripe' });
    installMockApi({
      [LIST_ROUTE]: () => ({ status: 200, data: makeListResponse([application]) }),
      [DETAIL_ROUTE]: () => ({ status: 200, data: successBody({ application }) }),
      'GET /calendar': () => ({ status: 200, data: successBody({ events: [] }) }),
    });
    signIn(makeSession());

    renderWithProviders(<App />, { route });

    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.queryByTestId('phase-placeholder')).not.toBeInTheDocument();
  });

  it('renders the 404 page for an unknown path without asking for a session', async () => {
    installMockApi({});
    signIn(makeSession());

    renderWithProviders(<App />, { route: '/nope' });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'That page does not exist' }),
    ).toBeInTheDocument();
  });

  it('keeps a signed-in user off the login page', async () => {
    installMockApi({});
    signIn(makeSession());

    renderWithProviders(<App />, { route: '/login' });

    expect(await screen.findByTestId('phase-placeholder')).toHaveAttribute('data-phase', '8');
  });

  it('offers the sign-in link from the 404 page', async () => {
    installMockApi({});
    signIn(makeSession());

    renderWithProviders(<App />, { route: '/nope' });

    expect(await screen.findByRole('link', { name: 'Back to the dashboard' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});

describe('post-login redirect target', () => {
  it('uses the path ProtectedRoute stashed', () => {
    expect(readRedirectTarget({ from: '/applications/board?status=applied' })).toBe(
      '/applications/board?status=applied',
    );
  });

  it('falls back to the dashboard when there is nothing to go back to', () => {
    expect(readRedirectTarget(null)).toBe('/');
    expect(readRedirectTarget({})).toBe('/');
    expect(readRedirectTarget({ from: 42 })).toBe('/');
  });

  it('refuses a protocol-relative path, which would be an open redirect', () => {
    expect(readRedirectTarget({ from: '//evil.example' })).toBe('/');
    expect(readRedirectTarget({ from: 'https://evil.example' })).toBe('/');
  });
});
