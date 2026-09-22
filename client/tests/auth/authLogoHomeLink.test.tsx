import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '@/App';
import { paths } from '@/routes/paths';
import { makeUser } from '../utils/factories';
import { installMockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState } from '../utils/render';

/**
 * Every logged-out page that renders through `AuthSplitLayout`. The lockup in
 * its aside used to be a static span, and the aside itself is hidden below
 * `lg`, which left these pages with no route back to the landing page at any
 * width: the only links on them point at each other. The layout now renders
 * the lockup twice, once in the aside and once in the form column's top bar,
 * and CSS shows exactly one of them per breakpoint. jsdom applies no CSS, so
 * both are in the tree here; the tests tell them apart by landmark.
 */
const AUTH_ROUTES = [
  paths.login,
  paths.register,
  paths.forgotPassword,
  paths.resetPassword,
  paths.verifyEmail,
  paths.accountClosed,
] as const;

const HERO = /never miss a deadline/i;

beforeEach(() => {
  resetClientState();
  // `/verify-email` posts its token on mount; the rest make no request.
  installMockApi({
    'POST /auth/verify-email': () => ({
      status: 200,
      data: { success: true, data: { user: makeUser({ emailVerified: true }) } },
    }),
  });
});

afterEach(() => {
  resetClientState();
});

/** The one lockup inside a landmark, or a failure naming which one is missing. */
function logoWithin(landmark: HTMLElement): HTMLElement {
  // The wordmark is the link's visible text and the mark is `aria-hidden`,
  // so the accessible name is the same one the marketing header's logo has.
  return within(landmark).getByRole('link', { name: 'Internship Tracker' });
}

function expectLockupLink(logo: HTMLElement): void {
  expect(logo).toHaveAttribute('href', paths.landing);
  // Both halves of the lockup sit inside the one target, not just the text.
  expect(logo.querySelector('svg')).not.toBeNull();
  expect(logo).toHaveTextContent('Internship Tracker');
}

describe('the auth pages link their logo back to the landing page', () => {
  it.each(AUTH_ROUTES)('%s links the lockup in the aside, for wide screens', async (route) => {
    renderWithProviders(<App />, { route });

    expectLockupLink(logoWithin(await screen.findByRole('complementary')));
  });

  it.each(AUTH_ROUTES)('%s links the lockup in the form column, for phones', async (route) => {
    renderWithProviders(<App />, { route });

    expectLockupLink(logoWithin(await screen.findByRole('main')));
  });

  it('renders the lockup exactly twice, one per breakpoint', async () => {
    renderWithProviders(<App />, { route: paths.login });

    expect(await screen.findAllByRole('link', { name: 'Internship Tracker' })).toHaveLength(2);
  });

  it('actually reaches the landing page from the aside lockup', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />, { route: paths.register });

    await user.click(logoWithin(await screen.findByRole('complementary')));

    expect(await screen.findByRole('heading', { level: 1, name: HERO })).toBeInTheDocument();
  });

  it('actually reaches the landing page from the form-column lockup', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />, { route: paths.register });

    await user.click(logoWithin(await screen.findByRole('main')));

    expect(await screen.findByRole('heading', { level: 1, name: HERO })).toBeInTheDocument();
  });
});
