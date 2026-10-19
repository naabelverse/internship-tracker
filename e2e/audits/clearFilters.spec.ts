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
 * - At 1280 the same holds (issue #87): the field stops at 18rem up to 1375px,
 *   since a 24rem field left 60px of the ~156px the button needs and Filters
 *   moved 96.1px left.
 * - At 375 every toolbar menu opens inside the page's 16px gutter (issue #85).
 *   Placed with CSS alone, Columns opened at x = -117 and Filters ran past the
 *   right edge.
 *
 * One application is seeded and it matches the filter, so the list never shows
 * the empty state and its own "Clear filters".
 *
 * The first three checks are soft so that a regression reports each of them,
 * and the focus check starts from Clear filters itself rather than from Tab.
 */
test('Clear filters appears beside Filters without moving it, and hands focus back to it; menus stay on screen', async ({
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

  await page.setViewportSize({ width: 1280, height: 900 });
  await filters.click();
  const before1280 = await leftEdge();
  await page.getByRole('checkbox', { name: 'Applied', exact: true }).click();
  await expect(clear).toBeVisible();
  // Within half a pixel: flex rounding moves it 0.08px as the badge appears.
  expect.soft(await leftEdge(), 'Filters left edge at 1280').toBeCloseTo(before1280, 0);
  await page.keyboard.press('Escape');
  await clear.click();
  await expect(clear).toBeHidden();

  await page.setViewportSize({ width: 375, height: 900 });
  const pageWidth = await page.evaluate(
    () => document.documentElement.getBoundingClientRect().width,
  );
  for (const name of ['Columns', 'Export CSV', 'Filters']) {
    const trigger = page.getByRole('main').getByRole('button', { name: new RegExp(`^${name}`) });
    await trigger.click();
    const panel = trigger.locator('xpath=following-sibling::*[1]');
    const box = await panel.boundingBox();
    expect.soft(box?.x, `${name} panel left edge at 375`).toBeGreaterThanOrEqual(16);
    expect
      .soft((box?.x ?? 0) + (box?.width ?? 0), `${name} panel right edge at 375`)
      .toBeLessThanOrEqual(pageWidth - 16);
    await page.keyboard.press('Escape');
  }
});
