import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { App } from '@/App';
import { readRedirectTarget } from '@/routes/redirectTarget';
import {
  errorBody,
  makeApplication,
  makeEmptySummary,
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

/** Enough of the analytics surface for the dashboard route to finish rendering. */
function dashboardRoutes(): Record<string, () => { status: number; data: unknown }> {
  return {
    'GET /analytics/summary': () => ({ status: 200, data: successBody(makeEmptySummary()) }),
    'GET /analytics/status-breakdown': () => ({
      status: 200,
      data: successBody({ breakdown: [] }),
    }),
    'GET /analytics/timeline': () => ({
      status: 200,
      data: successBody({ granularity: 'day', range: '90d', points: [] }),
    }),
    'GET /analytics/by-source': () => ({ status: 200, data: successBody({ sources: [] }) }),
    'GET /analytics/funnel': () => ({ status: 200, data: successBody({ stages: [] }) }),
    'GET /analytics/top-companies': () => ({ status: 200, data: successBody({ companies: [] }) }),
    'GET /calendar': () => ({ status: 200, data: successBody({ events: [] }) }),
  };
}

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

  // Every route now renders its real page: phase 6 replaced Applications and
  // Detail, phase 7 the Board and Calendar, phase 8 the Dashboard and phase 9
  // Settings. `PhasePlaceholder` was deleted with the last of them.
  it('renders the real settings page for a signed-in user', async () => {
    installMockApi({});
    signIn(makeSession());

    renderWithProviders(<App />, { route: '/settings' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeInTheDocument();
  });

  it('resolves the lazy dashboard chunk and renders it at /', async () => {
    installMockApi(dashboardRoutes());
    signIn(makeSession());

    renderWithProviders(<App />, { route: '/' });

    // The dashboard is the one route behind React.lazy, so this also proves the
    // Suspense fallback gives way rather than sticking on the skeleton.
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
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
    installMockApi(dashboardRoutes());
    signIn(makeSession());

    renderWithProviders(<App />, { route: '/login' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
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
