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

/**
 * Where the weekly pace panel sits, with the follow-through figures above it.
 * Beside the grid needs a 48rem card: 28rem of grid and at least 260px of
 * panel. A 1024 window with the sidebar open has a 662px card, about 186px
 * beside the grid, so it stacks; 1280 has 918px.
 */
const PACE_LAYOUT = [
  [375, 'below'],
  [768, 'below'],
  [1024, 'below'],
  [1280, 'beside'],
  [1440, 'beside'],
] as const;

test('the weekly pace panel sits beside the grid only when it has room', async ({ page }) => {
  const account = newAccount('pace');
  const api = await apiFor(12);
  const { accessToken } = await registerAccount(api, account);
  await createApplication(api, accessToken, { company: 'Pace Co', role: 'Intern' });
  await api.dispose();

  await signIn(page, account);

  const card = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Activity' }) });
  const grid = card.getByRole('img', { name: /activity heatmap/i });
  const cells = grid.getByTestId('heatmap-cell');
  const plot = card.getByRole('img', { name: /applications added per week/i });
  const bars = plot.getByTestId('pace-bar');
  const labels = card.locator('ul[aria-hidden="true"]');
  const figures = card.locator('dl');
  const paceHeading = card.getByRole('heading', { level: 3, name: 'Weekly pace' });

  await expect(bars).toHaveCount(12);

  for (const [width, placement] of PACE_LAYOUT) {
    await page.setViewportSize({ width, height: 900 });
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);

    const gridBox = await box(grid);
    const plotBox = await box(plot);
    const labelsBox = await box(labels);
    const figuresBox = await box(figures);
    const headingBox = await box(paceHeading);
    const at = `@ ${String(width)}px`;

    // Follow-through always sits above Weekly pace, on the pace panel's left edge.
    expect(figuresBox.bottom, `figures above weekly pace ${at}`).toBeLessThan(headingBox.top);
    expect(figuresBox.left, `figures on the pace panel's edge ${at}`).toBeCloseTo(plotBox.left, 0);

    // The weekday labels keep their own narrow column. The legend spans it, and
    // once sized that column to "Less … More", which cost the grid 102px.
    expect(gridBox.left - labelsBox.left, `label column width ${at}`).toBeLessThan(32);

    if (placement === 'below') {
      expect(plotBox.top, `pace below the grid ${at}`).toBeGreaterThan(gridBox.bottom);
      expect(figuresBox.top, `figures below the grid ${at}`).toBeGreaterThan(gridBox.bottom);
      expect(plotBox.width, `pace as wide as the grid ${at}`).toBeCloseTo(gridBox.width, 0);

      // Each bar under its own week: the column's top cell shares its centre.
      for (const week of [0, 5, 11]) {
        const cell = await box(cells.nth(week * 7));
        const bar = await box(bars.nth(week));

        expect(
          Math.abs((bar.left + bar.right) / 2 - (cell.left + cell.right) / 2),
          `week ${String(week)} bar under its column ${at}`,
        ).toBeLessThan(0.5);
      }
    } else {
      expect(plotBox.left, `pace right of the grid ${at}`).toBeGreaterThan(gridBox.right);
      // In the empty top of the column, level with the grid's first row.
      expect(
        Math.abs(figuresBox.top - gridBox.top),
        `figures level with the grid ${at}`,
      ).toBeLessThan(1);
      expect(plotBox.bottom, `pace level with the grid ${at}`).toBeLessThan(gridBox.bottom + 40);
      expect(gridBox.width, `grid unsqueezed beside the pace ${at}`).toBeCloseTo(GRID_CAP, 0);
      expect(plotBox.width, `pace keeps its 260px floor ${at}`).toBeGreaterThanOrEqual(260);
    }
  }
});

/**
 * Each application's history opens with an entry the timeline counts as a
 * status change. One application and no moves must read 0 status updates in
 * both places the count appears, not the raw 1.
 */
test('a new application is not counted as its own status update', async ({ page }) => {
  const account = newAccount('follow');
  const api = await apiFor(12);
  const { accessToken } = await registerAccount(api, account);
  await createApplication(api, accessToken, { company: 'Follow Co', role: 'Intern' });
  await api.dispose();

  await signIn(page, account);

  const card = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Activity' }) });

  await expect(card.locator('dt:text-is("Added") + dd')).toHaveText('1');
  await expect(card.locator('dt:text-is("Status updates") + dd')).toHaveText('0');
  await expect(card.getByText('No status updates yet')).toBeVisible();
  // The Applications over time chart's text alternative, in the default weekly grouping.
  await expect(page.getByText('1 added, 0 status changes', { exact: true })).toBeAttached();
});

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
