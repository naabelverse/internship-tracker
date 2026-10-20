import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from '@/features/auth/LoginForm';
import { RegisterForm } from '@/features/auth/RegisterForm';
import type * as EnvModule from '@/lib/env';
import { renderWithProviders, resetClientState } from '../utils/render';

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return { clientEnv: { ...actual.clientEnv, googleAuthEnabled: true } };
});

afterEach(() => {
  resetClientState();
});

const googleLink = (): HTMLAnchorElement =>
  screen.getByRole('link', { name: 'Continue with Google' });

/**
 * Whether the form's own handler stopped the navigation. Read at `window`, after
 * React's handler, which then stops it regardless: jsdom cannot navigate.
 */
function clickIsHeld(link: HTMLAnchorElement): boolean {
  let held = false;
  window.addEventListener(
    'click',
    (event) => {
      held = event.defaultPrevented;
      event.preventDefault();
    },
    { once: true },
  );
  fireEvent.click(link);

  return held;
}

describe('Continue with Google', () => {
  it('starts a sign-in, never a sign-up, from the login form', () => {
    renderWithProviders(<LoginForm />, { route: '/login' });

    const href = new URL(googleLink().href);
    expect(href.pathname).toBe('/api/v1/auth/google');
    expect(href.searchParams.get('intent')).toBe('login');
  });

  it('explains a refusal the API sent back', () => {
    renderWithProviders(<LoginForm />, { route: '/login?oauth=NO_ACCOUNT' });

    expect(screen.getByText(/No account uses that Google address yet/)).toBeInTheDocument();
  });

  it('falls back to a generic message for a code it does not know', () => {
    renderWithProviders(<LoginForm />, { route: '/login?oauth=SOMETHING_NEW' });

    expect(screen.getByText(/Google sign-in did not complete/)).toBeInTheDocument();
  });

  it('holds a sign-up at the terms box until it is ticked', async () => {
    renderWithProviders(<RegisterForm />, { route: '/register' });

    expect(clickIsHeld(googleLink())).toBe(true);
    expect(
      await screen.findByText('Accept the Terms and Privacy Policy to continue'),
    ).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('checkbox'));

    const href = new URL(googleLink().href);
    expect(href.searchParams.get('intent')).toBe('register');
    expect(href.searchParams.get('timezone')).toBeTruthy();
    expect(clickIsHeld(googleLink())).toBe(false);
  });
});
