// Client address 20: 1 of 5 sign-ups and 1 of 5 sign-ins per 15 minutes.
import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { newAccount } from '../support/api';
import { waitForMailLink } from '../support/mailLog';
import { testForClient } from '../support/network';
import { dragCardTo, expectNoVisibleError, signIn } from '../support/ui';

const test = testForClient(20);

/** Tomorrow at 10:00 local, in the `datetime-local` input's own format. */
function tomorrowAtTen(): string {
  const day = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (value: number): string => String(value).padStart(2, '0');

  return `${String(day.getFullYear())}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T10:00`;
}

/**
 * SPEC section 17, Definition of Done item 4: register → login → create →
 * filter → drag on board → add interview → change status → view charts →
 * export CSV → logout, in one pass.
 *
 * Flows 01–08 cover each step on its own, each from a fresh account seeded
 * through the API. This one walks them in sequence as one user, through the UI
 * only, so state from each step is what the next one reads: the card dragged on
 * the board is the one the chart counts, and the status changed on the detail
 * page is the one the CSV exports. A seam between two steps is what the
 * single-step flows cannot see.
 */
test('one user walks the whole product from sign-up to sign-out', async ({ page }) => {
  test.setTimeout(120_000);
  const account = newAccount('journey');

  await test.step('register and verify from the emailed link', async () => {
    await page.goto('/register');
    await page.getByLabel('Name').fill(account.name);
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('checkbox').check();
    // The sign-up timing check rejects a form filled in under 2.5 s; see flow 01.
    await page.waitForTimeout(2_800);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

    await page.goto(await waitForMailLink(account.email, '/verify-email'));
    await expect(page.getByText(/confirmed|verified/i).first()).toBeVisible();
  });

  await test.step('sign out, then sign back in through the form', async () => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await signIn(page, account);
  });

  await test.step('create two applications', async () => {
    await page.goto('/applications');

    for (const [company, role, status] of [
      ['Stripe', 'Backend Intern', 'applied'],
      ['Figma', 'Design Engineer', 'saved'],
    ] as const) {
      await page.getByRole('button', { name: 'New application' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Company', { exact: true }).fill(company);
      await dialog.getByLabel('Role', { exact: true }).fill(role);
      await dialog.getByLabel('Status', { exact: true }).selectOption(status);
      await dialog.getByRole('button', { name: 'Create application' }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('link', { name: company })).toBeVisible();
    }
  });

  await test.step('filter by search and status', async () => {
    await page.getByLabel('Search applications').fill('stripe');
    await expect(page).toHaveURL(/search=stripe/);
    await page.getByRole('button', { name: /Filters/ }).click();
    // `click()` then a retrying assertion, not `check()`; see flow 04.
    const applied = page.getByRole('checkbox', { name: 'Applied' });
    await applied.click();
    await expect(applied).toBeChecked();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('link', { name: 'Stripe' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Figma' })).toHaveCount(0);
  });

  await test.step('drag Figma from Saved to Interview on the board', async () => {
    await page.goto('/applications/board');
    const interview = page.getByTestId('column-interview');
    await expect(page.getByTestId('column-saved').getByText('Figma')).toBeVisible();

    await dragCardTo(page, page.getByRole('button', { name: /^Move Figma/ }), interview);
    await expect(interview.getByText('Figma')).toBeVisible();

    // The board writes optimistically; only a reload proves the PATCH landed.
    await page.reload();
    await expect(page.getByTestId('column-interview').getByText('Figma')).toBeVisible();
  });

  await test.step('add an interview to Stripe', async () => {
    await page.goto('/applications');
    await page.getByRole('link', { name: 'Stripe' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Stripe/ })).toBeVisible();

    await page.getByRole('button', { name: 'Interview', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add an interview' });
    await dialog.getByLabel('Scheduled at', { exact: true }).fill(tomorrowAtTen());
    await dialog.getByRole('button', { name: 'Add interview' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Interview added')).toBeVisible();
  });

  await test.step('change Stripe to Offer from the detail page', async () => {
    const status = page.getByLabel('Application status');
    await status.selectOption('offer');
    await expect(status).toHaveValue('offer');
    await expect(status).toBeEnabled();

    await page.reload();
    await expect(page.getByLabel('Application status')).toHaveValue('offer');
  });

  await test.step('see both applications in the dashboard charts', async () => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('status-doughnut').locator('canvas')).toBeVisible();

    // The chart's text alternative carries the same numbers the canvas draws.
    const breakdown = page.getByRole('table', { name: 'Status breakdown of 2 applications' });
    await expect(breakdown.getByRole('row', { name: /Offer\s+1/ })).toHaveCount(1);
    await expect(breakdown.getByRole('row', { name: /Interview\s+1/ })).toHaveCount(1);
    await expectNoVisibleError(page);
  });

  await test.step('export the CSV and find every change in it', async () => {
    await page.goto('/applications');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    await page.getByRole('menuitem', { name: 'All fields' }).click();
    const download = await downloadPromise;

    const rows = (await readFile(await download.path(), 'utf8')).trim().split(/\r?\n/).slice(1);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.startsWith('Stripe,'))).toContain(',offer,');
    expect(rows.find((row) => row.startsWith('Figma,'))).toContain(',interview,');
  });

  await test.step('sign out, and a protected route sends you to login', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
