import { expect } from '@playwright/test';
import { apiFor, newAccount } from '../support/api';
import { waitForMailLink } from '../support/mailLog';
import { testForClient } from '../support/network';

const test = testForClient(1);

/**
 * SPEC section 10, flow 1: register, take the verification token from the mail
 * transport, confirm it, and land on the dashboard.
 *
 * The token is read out of the API's console transport rather than from the
 * database, because that is the path a real user's link travels: if the template
 * built a broken URL, reading the database would still pass.
 */
test('register, verify from the emailed link, and land on the dashboard', async ({ page }) => {
  const account = newAccount('register');

  await page.goto('/register');
  await page.getByLabel('Name').fill(account.name);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('checkbox').check();

  /*
    Phase 14's timing check rejects a sign-up completed in under
    `MIN_SIGNUP_FILL_MS` (2.5 s) as automated, and Playwright fills the form in
    a fraction of that. Waiting is not a workaround for a flaky test — it is
    this flow behaving like the human it is meant to represent, and the first
    run of this suite failing on "That sign-up looked automated" is the guard
    demonstrably working end to end.
  */
  await page.waitForTimeout(2_800);
  await page.getByRole('button', { name: 'Create account' }).click();

  // Registration signs the user in, unverified, and the banner is how the app
  // says so.
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

  const link = await waitForMailLink(account.email, '/verify-email');
  expect(link).toContain('/verify-email?token=');

  await page.goto(link);
  await expect(page.getByText(/confirmed|verified/i).first()).toBeVisible();

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

  // And the account really is verified now, not merely told that it is.
  const api = await apiFor(1);
  await api.dispose();
});
