// Client address 13: 1 of 5 sign-ups per 15 minutes.
import { expect, type Locator } from '@playwright/test';
import { apiFor, loadDemoData, newAccount, registerAccount, setWeeklyGoal } from '../support/api';
import { testForClient } from '../support/network';
import { signIn } from '../support/ui';

const test = testForClient(13);

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
 * The demo set, loaded through the real endpoint, must draw what its own text
 * says. Two pictures disagreed with their figures on `main`:
 *
 * - The goal line was a 1px border above a box whose bottom sat at the goal,
 *   so a week of exactly the goal ended 1px under it and read as falling
 *   short. Now the line is built like a bar, and that bar's top shares the
 *   stroke's pixel row. Every week at or over the goal reaches the stroke,
 *   every week under it clears it, and the ones reaching it are exactly
 *   "Goal met in N of 12 weeks".
 * - The heatmap shaded applications added only, while Active days counts
 *   added or moved. Shade is now both, so the shaded squares are that figure.
 *
 * The demo is dated relative to now, so whether a week lands exactly on the
 * default goal of 5 varies by day. The test then sets the goal to a week the
 * data does have, below the busiest, so the touching case always runs.
 */
const DEMO_WIDTHS = [375, 1024, 1440] as const;

test('on the demo data, the goal line and the heatmap agree with their figures', async ({
  page,
}) => {
  const account = newAccount('demo');
  const api = await apiFor(13);
  const { accessToken } = await registerAccount(api, account);
  await loadDemoData(api, accessToken);

  await signIn(page, account);

  const card = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Activity' }) });
  const cells = card.getByRole('img', { name: /activity heatmap/i }).getByTestId('heatmap-cell');
  const plot = card.getByRole('img', { name: /applications added per week/i });
  const goal = plot.getByTestId('pace-goal');
  const summary = card.getByText(/^Goal met in \d+ of 12 weeks/);
  const activeDays = card.locator('dt:text-is("Active days") + dd');
  // The legend's first swatch is level 0, the colour of an unshaded square.
  const blank = card.getByText('Less', { exact: true }).locator('xpath=following-sibling::span[1]');

  await expect(cells).toHaveCount(84);

  /** Each bar's count and its top less the stroke's: 0 shares the stroke's row. */
  async function checkGoalLine(at: string): Promise<number[]> {
    const target = Number(
      /Weekly goal: (\d+)\./.exec((await plot.getAttribute('aria-label')) ?? '')?.[1],
    );
    const met = Number(/Goal met in (\d+)/.exec((await summary.textContent()) ?? '')?.[1]);
    const stroke = (await box(goal)).top;
    const bars = await plot.getByTestId('pace-bar').evaluateAll(
      (items, top) =>
        items.map((item) => ({
          count: Number((item as HTMLElement).dataset.count),
          offset: item.getBoundingClientRect().top - top,
        })),
      stroke,
    );

    for (const bar of bars) {
      if (bar.count === target) {
        expect(
          Math.abs(bar.offset),
          `a week of exactly ${String(target)} touches it ${at}`,
        ).toBeLessThan(0.05);
      } else if (bar.count > target) {
        expect(bar.offset, `a week of ${String(bar.count)} crosses it ${at}`).toBeLessThan(0);
      } else {
        // Clear of the 1px stroke entirely, not merely under its top edge.
        expect(
          bar.offset,
          `a week of ${String(bar.count)} stays under it ${at}`,
        ).toBeGreaterThanOrEqual(1);
      }
    }
    expect(
      bars.filter((bar) => bar.offset < 0.05).length,
      `bars reaching the line = "Goal met in ${String(met)}" ${at}`,
    ).toBe(met);

    return bars.map((bar) => bar.count);
  }

  async function checkShading(at: string): Promise<void> {
    const unshaded = await blank.evaluate((el) => getComputedStyle(el).backgroundColor);
    const shaded = await cells.evaluateAll(
      (items, colour) =>
        items.filter((item) => getComputedStyle(item).backgroundColor !== colour).length,
      unshaded,
    );

    expect(shaded, `shaded squares = Active days ${at}`).toBe(
      Number(await activeDays.textContent()),
    );
  }

  let weeks: number[] = [];
  for (const width of DEMO_WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const at = `@ ${String(width)}px, goal 5`;

    weeks = await checkGoalLine(at);
    await checkShading(at);
  }

  // A goal some week sits exactly on, below the busiest so the line is not
  // simply the top of the plot.
  const busiest = Math.max(...weeks);
  const onGoal = Math.max(...weeks.filter((count) => count > 0 && count < busiest));
  await setWeeklyGoal(api, accessToken, onGoal);
  await api.dispose();
  await page.reload();
  await expect(plot).toHaveAttribute(
    'aria-label',
    new RegExp(`Weekly goal: ${String(onGoal)}\\.$`),
  );

  for (const width of DEMO_WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);

    const counts = await checkGoalLine(`@ ${String(width)}px, goal ${String(onGoal)}`);
    expect(counts, 'a week exactly on the goal to measure').toContain(onGoal);
  }
});
