import { expect, type Page } from '@playwright/test';
import type { TestAccount } from './api';

/**
 * Signs in through the real form, which is what flows about the session need:
 * seeding a token straight into the store would skip the cookie the silent
 * refresh depends on.
 */
export async function signIn(page: Page, account: TestAccount): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

/**
 * Asserts nothing failed in a way the user would see.
 *
 * `react-hot-toast` renders errors into a live region, and every error surface
 * in the app uses `role="alert"`. Several flows are specifically about a failure
 * *not* being shown — the silent refresh most of all — so this is the shared
 * definition of "no visible error" rather than eight slightly different ones.
 */
export async function expectNoVisibleError(page: Page): Promise<void> {
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(/something went wrong|could not be loaded/i)).toHaveCount(0);
}
