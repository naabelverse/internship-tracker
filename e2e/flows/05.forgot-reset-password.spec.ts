// Client address 5: 1 of 5 sign-ups per 15 minutes.
import { expect } from '@playwright/test';
import { apiFor, newAccount, registerAccount } from '../support/api';
import { waitForMailLink } from '../support/mailLog';
import { testForClient } from '../support/network';

const test = testForClient(5);

/**
 * SPEC section 10, flow 5: request a reset, follow the emailed link, set a new
 * password, and confirm the old one is refused and the new one accepted.
 *
 * Both halves matter. A reset that sets the new password without invalidating
 * the old one would pass a test that only checked the new one works.
 */
test('reset a password: the old one stops working and the new one starts', async ({ page }) => {
  const account = newAccount('reset');
  const api = await apiFor(5);
  await registerAccount(api, account);
  await api.dispose();

  const newPassword = 'E2eR3setPass!';

  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(account.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByTestId('forgot-password-sent')).toBeVisible();

  const link = await waitForMailLink(account.email, '/reset-password');
  await page.goto(link);

  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel(/Confirm/i).fill(newPassword);
  await page.getByRole('button', { name: /Set|Reset|Save/ }).click();

  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

  // The old password is refused.
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toHaveCount(0);

  // The new one is accepted.
  await page.getByLabel('Password', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});
