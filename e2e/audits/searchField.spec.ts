// Client address 14: 1 of 5 sign-ups per 15 minutes.
import { expect, type Locator } from '@playwright/test';
import { apiFor, newAccount, registerAccount } from '../support/api';
import { testForClient } from '../support/network';
import { signIn } from '../support/ui';

const test = testForClient(14);

/**
 * The Applications toolbar's search field, measured where jsdom cannot:
 *
 * - It shares the buttons' top and bottom edges. On `main` it sat 3px lower at
 *   both, because `TextField` gave its input a 6px top margin for a label that
 *   was visually hidden.
 * - Its search icon is painted above the input. On `main` the icon was rendered
 *   but painted under the input's opaque background. The icon is
 *   `pointer-events: none`, which `elementFromPoint` skips, so the probe turns
 *   pointer events on for the moment it asks; hit testing then follows paint
 *   order.
 * - The platform's own cancel button is hidden, so "Clear search" is the only
 *   clear control, and a long query stops before it rather than under it.
 *
 * Filters is the comparison because it shares the field's first row at every
 * width; New application wraps to a later row at 1024 and 375.
 */
const WIDTHS = [1440, 1024, 768, 375] as const;

interface Edges {
  top: number;
  bottom: number;
}

async function edges(locator: Locator): Promise<Edges> {
  return locator.evaluate((el) => {
    const { top, bottom } = el.getBoundingClientRect();
    return { top, bottom };
  });
}

test('the search field lines up with the toolbar buttons, shows its icon and has one clear button', async ({
  page,
}) => {
  const account = newAccount('search');
  const api = await apiFor(14);
  await registerAccount(api, account);
  await signIn(page, account);
  await page.getByRole('link', { name: 'Applications' }).first().click();

  const field = page.getByRole('searchbox', { name: 'Search applications' });
  const filters = page.getByRole('button', { name: /^Filters/ });
  await expect(field).toBeVisible();

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const [input, button] = await Promise.all([edges(field), edges(filters)]);

    expect(input.top, `top edge at ${String(width)}px`).toBeCloseTo(button.top, 1);
    expect(input.bottom, `bottom edge at ${String(width)}px`).toBeCloseTo(button.bottom, 1);
  }

  const iconOnTop = await field.evaluate((input) => {
    const icon = input.parentElement?.querySelector('svg');
    if (!icon?.parentElement) return false;
    const lifted = [icon, icon.parentElement] as (HTMLElement | SVGElement)[];
    lifted.forEach((el) => {
      el.style.pointerEvents = 'auto';
    });
    const { left, top, width, height } = icon.getBoundingClientRect();
    const hit = document.elementFromPoint(left + width / 2, top + height / 2);
    lifted.forEach((el) => {
      el.style.pointerEvents = '';
    });
    return hit !== null && icon.contains(hit);
  });
  expect(iconOnTop).toBe(true);

  await field.fill('a'.repeat(120));
  const clear = page.getByRole('button', { name: 'Clear search' });
  await expect(clear).toBeVisible();

  const layout = await field.evaluate((input) => {
    const style = getComputedStyle(input);
    const textEnd =
      input.getBoundingClientRect().right -
      parseFloat(style.borderRightWidth) -
      parseFloat(style.paddingRight);
    const clearButton = input.parentElement?.querySelector('button');
    // Chromium does not resolve getComputedStyle for this pseudo-element (it
    // answers `inline-block` whatever the stylesheet says), so look for a rule
    // that hides it and whose selector matches this input.
    const pseudo = '::-webkit-search-cancel-button';
    const hidesCancel = [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .some(
        (rule) =>
          rule instanceof CSSStyleRule &&
          rule.selectorText.endsWith(pseudo) &&
          rule.style.display === 'none' &&
          input.matches(rule.selectorText.slice(0, -pseudo.length)),
      );
    return {
      hidesCancel,
      textEnd,
      clearLeft: clearButton?.getBoundingClientRect().left ?? 0,
    };
  });
  expect(layout.hidesCancel).toBe(true);
  expect(layout.textEnd).toBeLessThanOrEqual(layout.clearLeft);
});
