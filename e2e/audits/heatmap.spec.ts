// Client address 12: 5 of 5 sign-ups per 15 minutes; full, so a new test that signs up needs its own file.
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

/** The card width (40rem) from which the side column sits beside the grid. */
const BESIDE_MIN = 640;

/** The side column's floor beside the grid: 15rem. */
const SIDE_FLOOR = 240;

/** Between the grid and the side column: a 1rem spacer track and two 8px gaps. */
const GUTTER = 32;

/** The card's content box, inside its border as well as its padding. */
async function contentEdges(card: Locator): Promise<{ left: number; right: number }> {
  return card.evaluate((el) => {
    const { left } = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      left: left + el.clientLeft + parseFloat(style.paddingLeft),
      right: left + el.clientLeft + el.clientWidth - parseFloat(style.paddingRight),
    };
  });
}

/**
 * Where the weekly pace panel sits, with the follow-through figures above it.
 * One rule: beside the grid from a 40rem card, where the side column takes the
 * rest of the card's width. A 1024 window with the sidebar open has a 662px
 * card, so it is beside, with the grid giving up width to the column's floor.
 */
const PACE_LAYOUT = [
  [375, 'below'],
  [768, 'beside'],
  [1024, 'beside'],
  [1280, 'beside'],
  [1440, 'beside'],
  [1536, 'beside'],
] as const;

test('the weekly pace panel sits beside the grid from a 40rem card and fills it', async ({
  page,
}) => {
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
  const figures = card.locator('dl').filter({ has: page.locator('dt:text-is("Added")') });
  const paceHeading = card.getByRole('heading', { level: 3, name: 'Weekly pace' });
  const figuresTitle = card.getByRole('heading', { level: 3, name: 'Follow-through' });
  const heatmapTitle = card.getByRole('heading', { level: 3, name: 'Daily activity' });

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
      const content = await contentEdges(card);
      const panelBox = await box(plot.locator('xpath=..'));
      const legendBox = await box(grid.locator('xpath=following-sibling::div[1]'));

      expect(content.right - content.left, `a 40rem card ${at}`).toBeGreaterThanOrEqual(BESIDE_MIN);
      expect(plotBox.left, `pace right of the grid ${at}`).toBeGreaterThan(gridBox.right);
      // Changed deliberately when the heatmap took a title: the two section
      // titles are level, and so are the figures row and the grid's top row.
      expect(
        Math.abs(
          (await box(figuresTitle.locator('xpath=..'))).top -
            (await box(heatmapTitle.locator('xpath=..'))).top,
        ),
        `Follow-through level with Daily activity ${at}`,
      ).toBeLessThan(1);
      expect(
        Math.abs(figuresBox.top - gridBox.top),
        `figures level with the grid ${at}`,
      ).toBeLessThan(1);

      // Nothing left empty to the right: the column runs to the card's edge,
      // never under its floor, and the grid gives up width only at that floor.
      expect(plotBox.right, `pace to the card's edge ${at}`).toBeCloseTo(content.right, 0);
      expect(plotBox.width, `pace keeps its 15rem floor ${at}`).toBeGreaterThanOrEqual(
        SIDE_FLOOR - 0.5,
      );
      expect(gridBox.width, `grid fills to its cap first ${at}`).toBeCloseTo(
        Math.min(GRID_CAP, content.right - gridBox.left - GUTTER - SIDE_FLOOR),
        0,
      );

      // The column never sets the card's height. The grid stretches with its
      // row, so a row grown by the column makes the grid taller than its seven
      // square cells and six gaps, both measured across, where no row
      // stretching reaches. The pace panel ends level with the legend, its
      // plot grown into the rest.
      const week0 = await box(cells.nth(0));
      const week1 = await box(cells.nth(7));
      const natural = 7 * week0.width + 6 * (week1.left - week0.right);
      expect(gridBox.height, `grid row no taller than the grid ${at}`).toBeCloseTo(natural, 0);
      expect(panelBox.bottom, `pace ends level with the legend ${at}`).toBeCloseTo(
        legendBox.bottom,
        0,
      );
      // 36px since the figures took a title and the rule above Weekly pace.
      expect(plotBox.height, `pace plot at least 36px ${at}`).toBeGreaterThanOrEqual(35.5);
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
  await expect(card.locator('dt:text-is("Active days") + dd').filter({ visible: true })).toHaveText(
    '1',
  );
  // The Applications over time chart's text alternative, in the default weekly grouping.
  await expect(page.getByText('1 added, 0 status changes', { exact: true })).toBeAttached();
});

/**
 * Active days is the third figure in the Added and Status updates row at every
 * width, rendered once. The row's columns never shrink below their content, so
 * no label wraps, down to the side column's 240px floor at 1024.
 */
const ACTIVE_DAYS_WIDTHS = [375, 768, 1024, 1280, 1366, 1440, 1536] as const;

test('Active days shows once, third in the figures row, which never wraps', async ({ page }) => {
  const account = newAccount('active');
  const api = await apiFor(12);
  const { accessToken } = await registerAccount(api, account);
  await createApplication(api, accessToken, { company: 'Active Co', role: 'Intern' });
  await api.dispose();

  await signIn(page, account);

  const card = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Activity' }) });
  const row = card.locator('dl').filter({ has: page.locator('dt:text-is("Added")') });
  const added = row.locator('dt:text-is("Added")');
  const updates = row.locator('dt:text-is("Status updates")');
  const shown = card.locator('dt:text-is("Active days")').filter({ visible: true });

  await expect(card.locator('dt:text-is("Active days")')).toHaveCount(1);

  for (const width of ACTIVE_DAYS_WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const at = `@ ${String(width)}px`;

    await expect(shown, `visible ${at}`).toHaveCount(1);
    // The browser's own accessibility tree reads it exactly once.
    const tree = await card.ariaSnapshot();
    expect(tree.match(/Active days/g)?.length, `read once ${at}`).toBe(1);

    const stat = await box(shown);
    const rowBox = await box(row);
    const addedBox = await box(added);
    const updatesBox = await box(updates);
    const content = await contentEdges(card);

    // One row of figures: level with Added, after Status updates, inside the row.
    expect(Math.abs(stat.top - addedBox.top), `level with Added ${at}`).toBeLessThan(1);
    expect(stat.left, `after Status updates ${at}`).toBeGreaterThan(updatesBox.right);
    expect(stat.right, `inside the row ${at}`).toBeLessThanOrEqual(rowBox.right + 0.5);
    expect(stat.right, `inside the card ${at}`).toBeLessThanOrEqual(content.right + 0.5);

    // No label wraps: a wrapped "Status updates" is twice the height of "Added".
    expect(updatesBox.height, `Status updates on one line ${at}`).toBeCloseTo(addedBox.height, 0);
    expect(stat.height, `Active days on one line ${at}`).toBeCloseTo(addedBox.height, 0);
  }
});

/**
 * The ratio line under the figures once carried its own (?) and sat 16px
 * above "Weekly pace (?)" at the same size, so it read as a second heading.
 * It is now the figures' caption, 4px under their row, and a rule sets
 * Weekly pace apart. Every gap inside a group is 8px or less; the one above
 * Weekly pace, rule included, is at least twice that.
 */
const GROUPING_WIDTHS = [320, 375, 768, 1024, 1440, 1920] as const;

test('the ratio line captions the figures, and a rule sets Weekly pace apart', async ({ page }) => {
  const account = newAccount('grouping');
  const api = await apiFor(12);
  const { accessToken } = await registerAccount(api, account);
  await createApplication(api, accessToken, { company: 'Grouping Co', role: 'Intern' });
  await api.dispose();

  await signIn(page, account);

  const card = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Activity' }) });
  const titleRow = card.getByRole('heading', { level: 3, name: 'Follow-through' }).locator('..');
  const row = card.locator('dl').filter({ has: page.locator('dt:text-is("Added")') });
  const ratio = row.locator('xpath=following-sibling::p[1]');
  const ofDays = row.locator('dd').filter({ hasText: /^of \d+ days$/ });
  const paceHeader = card
    .getByRole('heading', { level: 3, name: 'Weekly pace' })
    .locator('xpath=../..');
  const paceSection = paceHeader.locator('..');
  const plot = card.getByRole('img', { name: /applications added per week/i });

  for (const width of GROUPING_WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const at = `@ ${String(width)}px`;
    const content = await contentEdges(card);

    // No figure wraps or overflows: every label and numeral is one line, as
    // tall as Added's, and inside the card.
    const lines = await row.locator('dt, dd').evaluateAll((items) =>
      items.map((item) => {
        const { height, right } = item.getBoundingClientRect();
        return { text: item.textContent, height, right };
      }),
    );
    const [addedLabel, addedFigure] = lines;
    for (const line of lines) {
      const tall = /^\d+$/.test(line.text ?? '') ? addedFigure.height : addedLabel.height;
      expect(line.height, `"${String(line.text)}" on one line ${at}`).toBeCloseTo(tall, 0);
      expect(line.right, `"${String(line.text)}" inside the card ${at}`).toBeLessThanOrEqual(
        content.right + 0.5,
      );
    }
    expect((await box(ratio)).right, `ratio inside the card ${at}`).toBeLessThanOrEqual(
      content.right + 0.5,
    );

    // A caption: no (?) of its own, and no larger than "of N days".
    await expect(ratio.locator('xpath=..').getByRole('button'), `no tip ${at}`).toHaveCount(0);
    const style = async (locator: Locator): Promise<string> =>
      locator.evaluate((el) => {
        const { fontSize, fontWeight, color } = getComputedStyle(el);
        return `${fontSize} ${fontWeight} ${color}`;
      });
    expect(await style(ratio), `the style of "of N days" ${at}`).toBe(await style(ofDays));

    // Gaps inside the groups, then the one between them, rule included.
    const title = await box(titleRow);
    const figures = await box(row);
    const caption = await box(ratio);
    const header = await box(paceHeader);
    const plotBox = await box(plot);
    const inside = [
      figures.top - title.bottom,
      caption.top - figures.bottom,
      plotBox.top - header.bottom,
    ];
    const between = header.top - caption.bottom;

    expect(Math.max(...inside), `gaps inside a group ${at}`).toBeLessThanOrEqual(8.5);
    expect(between, `the gap above Weekly pace ${at}`).toBeGreaterThanOrEqual(
      2 * Math.max(...inside),
    );

    // The rule is the pace section's own top edge, inside that gap.
    const rule = await paceSection.evaluate((el) => {
      const { borderTopWidth, borderTopStyle } = getComputedStyle(el);
      return { width: borderTopWidth, style: borderTopStyle, top: el.getBoundingClientRect().top };
    });
    expect(rule, `a hairline above Weekly pace ${at}`).toMatchObject({
      width: '1px',
      style: 'solid',
    });
    expect(rule.top, `the rule under the ratio line ${at}`).toBeGreaterThan(caption.bottom);
  }
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

    const content = await contentEdges(card);
    const gridBox = await box(grid);
    const first = await box(cells.first());
    const room = content.right - gridBox.left;
    // Beside the grid, the side column's floor and gutter come out of the room.
    const share = content.right - content.left >= BESIDE_MIN ? room - GUTTER - SIDE_FLOOR : room;

    expect(Math.abs(first.width - first.height), `square cell @ ${String(width)}px`).toBeLessThan(
      0.5,
    );
    expect(gridBox.width, `grid width @ ${String(width)}px`).toBeCloseTo(
      Math.min(share, GRID_CAP),
      0,
    );
    expect(gridBox.right, `grid inside the card @ ${String(width)}px`).toBeLessThanOrEqual(
      content.right + 0.5,
    );

    for (const row of LABELLED_ROWS) {
      const label = await box(labels.nth(row));
      const cell = await box(cells.nth(row));
      const offset = (label.top + label.bottom) / 2 - (cell.top + cell.bottom) / 2;

      expect(Math.abs(offset), `row ${String(row)} label @ ${String(width)}px`).toBeLessThan(1);
    }
  }
});
