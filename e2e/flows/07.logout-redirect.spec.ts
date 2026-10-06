// Client address 7: 1 of 5 sign-ups per 15 minutes.
import { expect } from '@playwright/test';
import { apiFor, newAccount, registerAccount } from '../support/api';
import { testForClient } from '../support/network';
import { signIn } from '../support/ui';

const test = testForClient(7);

/**
 * SPEC section 10, flow 7: sign out, then find a protected route redirecting to
 * the login page.
 *
 * Navigating to the protected route *after* the logout is what makes this worth
 * running. A logout that only cleared the in-memory token would still look
 * signed out on screen while the refresh cookie quietly restored the session on
 * the next page load.
 */
test('after logging out, a protected route redirects to login', async ({ page }) => {
  const account = newAccount('logout');
  const api = await apiFor(7);
  await registerAccount(api, account);
  await api.dispose();

  await signIn(page, account);

  await page.getByRole('button', { name: /Sign out|Log out/i }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

  // A fresh navigation, so the cold-start session restore runs for real.
  await page.goto('/applications');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});
