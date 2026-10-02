import { expect, type Locator } from '@playwright/test';
import { apiFor, createApplication, newAccount, registerAccount } from '../support/api';
import { testForClient } from '../support/network';
import { signIn } from '../support/ui';

const test = testForClient(12);

/**
 * The Activity card spans the dashboard, but its grid was twelve fixed 12px
 * columns: 188px of a 1078px card at 1440, packed into the left-hand corner.
 * Cells now share the width as twelve equal square columns, capped where the
 * grid is as tall as the chart plots above it.
 *
 * jsdom applies no CSS, so none of this is visible to the client suite. These
 * are the browser's own boxes: square cells, a grid that fills the card until
 * the cap and then holds it, and weekday labels still centred on their rows —
 * which the old `justify-between` label column only managed at 12px.
 */

/** `max-w-md`: the grid's width cap. */
const GRID_CAP = 448;

/** The widths SPEC section 17 pins, plus 1024, the narrowest sidebar layout. */
const WIDTHS = [375, 768, 1024, 1440] as const;

/** Monday, Wednesday, Friday and Sunday carry a label; the rows between do not. */
const LABELLED_ROWS = [0, 2, 4, 6] as const;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

async function box(locator: Locator): Promise<Box> {
  return locator.evaluate((el) => {
    const { left, right, top, bottom, width, height } = el.getBoundingClientRect();
    return { left, right, top, bottom, width, height };
  });
}

test('the activity grid scales with its card and keeps its cells square', async ({ page }) => {
  const account = newAccount('heatmap');
  const api = await apiFor(12);
  const { accessToken } = await registerAccount(api, account);
  // An account with nothing in it gets the empty-state dashboard, not the card.
  await createApplication(api, accessToken, { company: 'Heatmap Co', role: 'Intern' });
  await api.dispose();

  await signIn(page, account);

  const card = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Activity' }) });
  const grid = card.getByRole('img', { name: /activity heatmap/i });
  const cells = grid.getByTestId('heatmap-cell');
  const labels = card.locator('ul[aria-hidden="true"] > li');

  await expect(cells).toHaveCount(84);

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);

    // The card's content edge, inside its border as well as its padding.
    const contentRight = await card.evaluate(
      (el) =>
        el.getBoundingClientRect().left +
        el.clientLeft +
        el.clientWidth -
        parseFloat(getComputedStyle(el).paddingRight),
    );
    const gridBox = await box(grid);
    const first = await box(cells.first());
    const room = contentRight - gridBox.left;

    expect(Math.abs(first.width - first.height), `square cell @ ${String(width)}px`).toBeLessThan(
      0.5,
    );
    expect(gridBox.width, `grid width @ ${String(width)}px`).toBeCloseTo(
      Math.min(room, GRID_CAP),
      0,
    );
    expect(gridBox.right, `grid inside the card @ ${String(width)}px`).toBeLessThanOrEqual(
      contentRight + 0.5,
    );

    for (const row of LABELLED_ROWS) {
      const label = await box(labels.nth(row));
      const cell = await box(cells.nth(row));
      const offset = (label.top + label.bottom) / 2 - (cell.top + cell.bottom) / 2;

      expect(Math.abs(offset), `row ${String(row)} label @ ${String(width)}px`).toBeLessThan(1);
    }
  }
});
