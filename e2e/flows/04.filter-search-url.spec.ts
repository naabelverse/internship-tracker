// Client address 4: 1 of 5 sign-ups per 15 minutes.
import { expect } from '@playwright/test';
import { apiFor, createApplication, newAccount, registerAccount } from '../support/api';
import { testForClient } from '../support/network';
import { signIn } from '../support/ui';

const test = testForClient(4);

/**
 * SPEC section 10, flow 4: filter and search, watch the URL update, reload, and
 * find the filters restored.
 *
 * SPEC section 6 requires the list's state to live in the query string so a view
 * is shareable. Reloading is the only way to prove it really does: state kept in
 * React alone would satisfy every assertion up to the reload.
 */
test('filters and search reach the URL and survive a reload', async ({ page }) => {
  const account = newAccount('filter');
  const api = await apiFor(4);
  const { accessToken } = await registerAccount(api, account);
  await createApplication(api, accessToken, {
    company: 'Stripe',
    role: 'Backend Intern',
    status: 'applied',
  });
  await createApplication(api, accessToken, {
    company: 'Figma',
    role: 'Design Engineer',
    status: 'interview',
  });
  await api.dispose();

  await signIn(page, account);
  await page.goto('/applications');
  await expect(page.getByText('Stripe')).toBeVisible();
  await expect(page.getByText('Figma')).toBeVisible();

  // Search is debounced at 300 ms, so the URL is asserted rather than raced.
  await page.getByLabel('Search applications').fill('stripe');
  await expect(page).toHaveURL(/search=stripe/);

  await page.getByRole('button', { name: /Filters/ }).click();

  /*
    `click()` and then a polling assertion, deliberately not `check()`.

    These filters are controlled inputs whose state round-trips through the URL:
    the change handler navigates, and the checkbox only re-renders as checked
    once React commits the new query string. `check()` clicks and then reads
    `input.checked` synchronously, landing inside the window where React has
    reset the DOM property to match a render that has not happened yet, so it
    reports "Clicking the checkbox did not change its state" while the URL, the
    checked state and the filtered rows all settle correctly a moment later.
    `toBeChecked()` retries, so it asserts the outcome rather than the instant.
  */
  const appliedFilter = page.getByRole('checkbox', { name: 'Applied' });
  await appliedFilter.click();
  await expect(appliedFilter).toBeChecked();
  await expect(page).toHaveURL(/status=applied/);
  await page.keyboard.press('Escape');

  await expect(page.getByText('Stripe')).toBeVisible();
  await expect(page.getByText('Figma')).toHaveCount(0);

  const filtered = page.url();
  await page.reload();

  await expect(page).toHaveURL(filtered);
  await expect(page.getByLabel('Search applications')).toHaveValue('stripe');
  await expect(page.getByText('Stripe')).toBeVisible();
  await expect(page.getByText('Figma')).toHaveCount(0);
});
