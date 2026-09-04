import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '@/App';
import { paths } from '@/routes/paths';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  THEME_STORAGE_KEY,
  readStoredPreference,
  resolveTheme,
  useThemeStore,
} from '@/store/themeStore';
import { errorBody, makeSession, makeUser, successBody } from '../utils/factories';
import { installMockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

const REFRESH = 'POST /auth/refresh';
const ME = 'GET /auth/me';
const PATCH_ME = 'PATCH /auth/me';

/**
 * Puts the theme store back to what a cold page load would produce, which is
 * whatever `index.html` found in local storage. The store is a module singleton
 * built once at import, so without this a second "boot" in the same file would
 * inherit the previous test's in-memory preference and prove nothing.
 */
function bootThemeStoreFromStorage(): void {
  const preference = readStoredPreference();
  useThemeStore.setState({ preference, resolved: resolveTheme(preference) });
  document.documentElement.setAttribute('data-theme', resolveTheme(preference));
}

/** The dashboard's requests, so mounting the whole App at `/` can settle. */
const dashboardRoutes: Record<string, Responder> = {
  'GET /analytics/summary': () => ({
    status: 200,
    data: successBody({
      total: 0,
      active: 0,
      applied: 0,
      responded: 0,
      interviewed: 0,
      offers: 0,
      responseRate: 0,
      interviewRate: 0,
      offerRate: 0,
      avgDaysToFirstResponse: null,
      currentStreakDays: 0,
      weeklyGoal: { target: 5, completed: 0, percentage: 0, previousCompleted: 0 },
      period: {
        days: 30,
        current: {
          created: 0,
          active: 0,
          applied: 0,
          responded: 0,
          interviewed: 0,
          offers: 0,
          responseRate: 0,
        },
        previous: {
          created: 0,
          active: 0,
          applied: 0,
          responded: 0,
          interviewed: 0,
          offers: 0,
          responseRate: 0,
        },
      },
    }),
  }),
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

beforeEach(() => {
  resetClientState();
  window.localStorage.clear();
  useThemeStore.setState({ preference: 'dark', resolved: 'dark' });
  document.documentElement.setAttribute('data-theme', 'dark');
});

afterEach(() => {
  resetClientState();
});

describe('theme follows the account', () => {
  it('writes a choice made while signed in through to the account', async () => {
    const user = userEvent.setup();
    const session = makeSession({ user: makeUser({ theme: 'dark' }) });
    const api = installMockApi({
      [PATCH_ME]: () => ({
        status: 200,
        data: successBody({ user: { ...session.user, theme: 'light' } }),
      }),
    });
    signIn(session);

    renderWithProviders(<ThemeToggle />);
    await user.click(screen.getByRole('radio', { name: 'Light theme' }));

    await waitFor(() => {
      expect(api.callsTo('PATCH', '/auth/me')).toHaveLength(1);
    });
    expect(api.callsTo('PATCH', '/auth/me')[0].data).toEqual({ theme: 'light' });
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });

  it('survives a fresh login, taking the account value over a stale local one', async () => {
    // Somebody chose light on this device, then their account moved to dark
    // somewhere else. A reload has to land on dark.
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    bootThemeStoreFromStorage();

    expect(document.documentElement).toHaveAttribute('data-theme', 'light');

    installMockApi({
      [REFRESH]: () => ({ status: 200, data: successBody({ accessToken: 'fresh' }) }),
      [ME]: () => ({ status: 200, data: successBody({ user: makeUser({ theme: 'dark' }) }) }),
      ...dashboardRoutes,
    });

    renderWithProviders(<App />, { route: paths.dashboard });

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    });
    // Written back, so the inline boot script paints dark next time with no
    // flash of the value this device used to hold.
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(useThemeStore.getState().preference).toBe('dark');
  });

  it('leaves local storage alone when the account already agrees', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system');
    bootThemeStoreFromStorage();

    installMockApi({
      [REFRESH]: () => ({ status: 200, data: successBody({ accessToken: 'fresh' }) }),
      [ME]: () => ({ status: 200, data: successBody({ user: makeUser({ theme: 'system' }) }) }),
      ...dashboardRoutes,
    });

    renderWithProviders(<App />, { route: paths.dashboard });

    await waitFor(() => {
      expect(useThemeStore.getState().preference).toBe('system');
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });

  it('rolls the theme back when the account write fails', async () => {
    const user = userEvent.setup();
    signIn(makeSession({ user: makeUser({ theme: 'dark' }) }));
    installMockApi({
      [PATCH_ME]: () => ({ status: 500, data: errorBody('Server error', 'INTERNAL_ERROR') }),
    });

    renderWithProviders(<ThemeToggle />);
    await user.click(screen.getByRole('radio', { name: 'Light theme' }));

    // Applied optimistically so the control feels instant, then undone, because
    // a screen that disagrees with the account is the bug this sync prevents.
    await waitFor(() => {
      expect(useThemeStore.getState().preference).toBe('dark');
    });
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('keeps a signed-out choice local, with no account write', async () => {
    const user = userEvent.setup();
    const api = installMockApi({});

    renderWithProviders(<ThemeToggle />);
    await user.click(screen.getByRole('radio', { name: 'Light theme' }));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(api.callsTo('PATCH', '/auth/me')).toHaveLength(0);
  });
});
