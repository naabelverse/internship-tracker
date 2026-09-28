import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/App';
import { paths } from '@/routes/paths';
import { THEME_STORAGE_KEY, useThemeStore } from '@/store/themeStore';
import type { ThemePreference } from '@/types/user';
import { dashboardRoutes } from '../utils/dashboardRoutes';
import { makeSession, makeUser, successBody } from '../utils/factories';
import { installMockApi, type MockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState } from '../utils/render';
import { bootThemeStoreFromStorage, simulateReload, stubMatchMedia } from '../utils/themeHarness';

/**
 * The shared demo account's stored theme is whatever the last visitor picked,
 * so it must never replace the theme this visitor arrived with. A real account's
 * stored theme still wins, which is the last case here.
 */

const HERO = /never miss a deadline/i;

/** The demo account, holding a theme the visitor did not choose. */
function demoUser(theme: ThemePreference) {
  return makeUser({ name: 'Demo Student', isDemo: true, theme });
}

/** A visitor who chose `preference` on an earlier visit, arriving on the landing page. */
function arriveWith(preference: ThemePreference): void {
  window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  bootThemeStoreFromStorage();
}

async function enterDemo(accountTheme: ThemePreference): Promise<MockApi> {
  const user = userEvent.setup();
  const api = installMockApi({
    'POST /auth/demo': () => ({
      status: 200,
      data: successBody(makeSession({ user: demoUser(accountTheme) })),
    }),
    'POST /auth/logout': () => ({ status: 200, data: successBody(null) }),
    ...dashboardRoutes,
  });

  renderWithProviders(<App />, { route: paths.landing });
  await screen.findByRole('heading', { level: 1, name: HERO });
  await user.click(screen.getByRole('button', { name: 'Try the demo' }));

  // The authenticated shell is up, so `useAccountTheme` has already run.
  expect(await screen.findByText('Skip to main content')).toBeInTheDocument();
  return api;
}

function expectTheme(preference: ThemePreference, painted: 'light' | 'dark'): void {
  expect(useThemeStore.getState().preference).toBe(preference);
  expect(document.documentElement).toHaveAttribute('data-theme', painted);
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(preference);
}

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetClientState();
});

describe('Try the demo keeps the theme the visitor arrived with', () => {
  it('keeps a light visitor in light when the demo account holds dark', async () => {
    arriveWith('light');

    await enterDemo('dark');

    expectTheme('light', 'light');
  });

  it('keeps a dark visitor in dark when the demo account holds light', async () => {
    arriveWith('dark');

    await enterDemo('light');

    expectTheme('dark', 'dark');
  });

  it.each([
    { os: 'light', prefersLight: true, accountTheme: 'dark' },
    { os: 'dark', prefersLight: false, accountTheme: 'light' },
  ] as const)(
    'keeps a system visitor following an OS set to $os',
    async ({ os, prefersLight, accountTheme }) => {
      stubMatchMedia(prefersLight);
      arriveWith('system');

      await enterDemo(accountTheme);

      expectTheme('system', os);
    },
  );
});

describe('a demo session restored by a refresh', () => {
  it('stays light when /auth/me brings the demo account back', async () => {
    arriveWith('light');
    await enterDemo('dark');

    simulateReload();
    const api = installMockApi({
      'POST /auth/refresh': () => ({ status: 200, data: successBody({ accessToken: 'fresh' }) }),
      'GET /auth/me': () => ({ status: 200, data: successBody({ user: demoUser('dark') }) }),
      ...dashboardRoutes,
    });
    renderWithProviders(<App />, { route: paths.dashboard });

    expect(await screen.findByText('Skip to main content')).toBeInTheDocument();
    expect(api.callsTo('GET', '/auth/me')).toHaveLength(1);
    expectTheme('light', 'light');
  });
});

describe('signing out of the demo', () => {
  it('leaves the visitor with the theme they had before entering it', async () => {
    const user = userEvent.setup();
    arriveWith('light');
    const api = await enterDemo('dark');

    const [signOut] = screen.getAllByRole('button', { name: 'Sign out' });
    if (!signOut) throw new Error('No sign-out control in the shell');
    await user.click(signOut);

    await waitFor(() => {
      expect(api.callsTo('POST', '/auth/logout')).toHaveLength(1);
    });
    await screen.findByRole('button', { name: 'Sign in' });
    expectTheme('light', 'light');
  });
});

describe('a normal sign-in', () => {
  it('still applies the account’s own stored theme over the device’s', async () => {
    const user = userEvent.setup();
    arriveWith('light');
    installMockApi({
      'POST /auth/login': () => ({
        status: 200,
        data: successBody(makeSession({ user: makeUser({ theme: 'dark' }) })),
      }),
      ...dashboardRoutes,
    });

    renderWithProviders(<App />, { route: paths.login });
    await user.type(await screen.findByLabelText('Email'), 'ada@example.test');
    await user.type(screen.getByLabelText('Password'), 'CorrectHorse9');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Skip to main content')).toBeInTheDocument();
    expectTheme('dark', 'dark');
  });
});
