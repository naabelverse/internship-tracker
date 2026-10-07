// Client address 17: 1 of 5 sign-ups per 15 minutes.
import { expect } from '@playwright/test';
import { apiFor, createApplication, newAccount, registerAccount } from '../support/api';
import { testForClient } from '../support/network';
import { signIn } from '../support/ui';

const test = testForClient(17);

/**
 * The Applications toolbar's "Clear filters", measured where jsdom cannot.
 *
 * - At 1440 the search field stops at 24rem and the buttons after Clear filters
 *   keep to the right edge, so the button appearing takes free space: Filters,
 *   and the panel open under it, stay put. On `main` the search field took all
 *   the slack, and ticking the first box moved both 129.9px left.
 * - It comes straight after Filters in the tab order, not after Columns.
 * - Clearing moves focus to Filters, rather than dropping it on the page body
 *   when the button it was on goes away.
 *
 * One application is seeded and it matches the filter, so the list never shows
 * the empty state and its own "Clear filters". Narrow widths are left out: the
 * open panel's placement there is tracked separately.
 *
 * The first three checks are soft so that a regression reports each of them,
 * and the focus check starts from Clear filters itself rather than from Tab.
 */
test('Clear filters appears beside Filters without moving it, and hands focus back to it', async ({
  page,
}) => {
  const account = newAccount('clear');
  const api = await apiFor(17);
  const { accessToken } = await registerAccount(api, account);
  await createApplication(api, accessToken, {
    company: 'Stripe',
    role: 'Backend Intern',
    status: 'applied',
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, account);
  await page.getByRole('link', { name: 'Applications' }).first().click();
  await expect(page.getByText('Stripe')).toBeVisible();

  const filters = page.getByRole('button', { name: /^Filters/ });
  const clear = page.getByRole('button', { name: 'Clear filters' });
  const leftEdge = async (): Promise<number> => (await filters.boundingBox())?.x ?? Number.NaN;

  await filters.click();
  const before = await leftEdge();
  await page.getByRole('checkbox', { name: 'Applied', exact: true }).click();
  await expect(clear).toBeVisible();
  expect
    .soft(await leftEdge(), 'Filters left edge once Clear filters appears')
    .toBeCloseTo(before, 1);

  await page.keyboard.press('Escape');
  await expect(filters).toBeFocused();
  const followsFilters = await clear.evaluate((button) => {
    const all = [...document.querySelectorAll('button, input, a[href]')];
    const previous = all[all.indexOf(button) - 1];
    return previous?.textContent?.trim().startsWith('Filters') === true;
  });
  expect
    .soft(followsFilters, 'Clear filters is the next control after Filters in the DOM')
    .toBe(true);
  await page.keyboard.press('Tab');
  await expect.soft(clear, 'Tab from Filters reaches Clear filters').toBeFocused();

  await clear.focus();
  await page.keyboard.press('Enter');
  await expect(clear).toBeHidden();
  await expect(filters).toBeFocused();
});
