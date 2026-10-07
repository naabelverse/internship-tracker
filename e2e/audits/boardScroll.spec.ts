// Client address 18: 1 of 5 sign-ups per 15 minutes.
import { expect, type Locator, type Page } from '@playwright/test';
import { apiFor, createApplication, newAccount, registerAccount } from '../support/api';
import { testForClient } from '../support/network';
import { signIn } from '../support/ui';

const test = testForClient(18);

/** Where the board, the page and the Saved column's list stand, read off the live layout. */
async function geometry(page: Page): Promise<Record<string, number | boolean>> {
  return page.evaluate(() => {
    const board = document.querySelector('[data-testid="kanban-board"]') as HTMLElement;
    const list = document.querySelector('[data-testid="column-saved"] ul') as HTMLElement;
    return {
      viewportHeight: window.innerHeight,
      pageOverflow: document.documentElement.scrollHeight - window.innerHeight,
      boardBottom: board.getBoundingClientRect().bottom,
      boardOverflowsSideways: board.scrollWidth > board.clientWidth,
      boardVerticalOverflow: board.scrollHeight - board.clientHeight,
      listScrolls: list.scrollHeight > list.clientHeight,
    };
  });
}

/** Presses a card's Move handle and carries it to a point, past dnd-kit's 4 px activation. */
async function pickUp(page: Page, handle: Locator, x: number, y: number): Promise<void> {
  const box = await handle.boundingBox();
  if (!box) throw new Error('The Move handle has no layout box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(x, y, { steps: 20 });
}

/**
 * The board's scroll geometry, which jsdom cannot see.
 *
 * - From 768 by 560 up the board takes the height the window leaves it: its
 *   sideways scrollbar, drawn along its bottom edge, is on screen without
 *   scrolling the page, and a tall column scrolls inside itself under a header
 *   that stays put. On `main` that edge sat about 2,500 px down the page.
 * - "Jump to column" brings an off-screen column into view.
 * - A dragged card is still drawn once it leaves its column (it used to be
 *   clipped by the column's list), and holding it at a tall list's bottom edge
 *   scrolls that list. Both drags are cancelled, so nothing is written.
 * - Below either bound (a landscape phone, a phone) the board flows in the page
 *   as before, with no scroll inside a column to trap the page.
 *
 * Headless Chromium hides scrollbars, so the scrollbar is located by the edge it
 * is drawn on rather than by its thickness.
 */
test('the board fits the window from 768 by 560 up and flows as before below it', async ({
  page,
}) => {
  const account = newAccount('boardfit');
  const api = await apiFor(18);
  const { accessToken } = await registerAccount(api, account);
  for (let index = 1; index <= 8; index += 1) {
    await createApplication(api, accessToken, {
      company: `Saved ${String(index)}`,
      role: 'Intern',
      status: 'saved',
    });
  }
  await createApplication(api, accessToken, {
    company: 'Last column',
    role: 'Intern',
    status: 'withdrawn',
  });
  await api.dispose();

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, account);
  await page.goto('/applications/board');
  await expect(
    page.getByTestId('column-saved').getByText('Saved 1', { exact: true }),
  ).toBeVisible();

  for (const [width, height] of [
    [1440, 900],
    [768, 1024],
  ]) {
    await page.setViewportSize({ width, height });
    const fitted = await geometry(page);
    const at = `${String(width)}x${String(height)}`;
    expect
      .soft(fitted.pageOverflow, `${at}: the page itself does not scroll`)
      .toBeLessThanOrEqual(0);
    expect
      .soft(fitted.boardBottom, `${at}: the scrollbar's edge is on screen`)
      .toBeLessThanOrEqual(height);
    expect
      .soft(fitted.boardOverflowsSideways, `${at}: the board still scrolls sideways`)
      .toBe(true);
    expect.soft(fitted.listScrolls, `${at}: the tall column scrolls on its own`).toBe(true);
    expect
      .soft(fitted.boardVerticalOverflow, `${at}: no vertical scroll on the board itself`)
      .toBe(0);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const saved = page.getByTestId('column-saved');
  const header = await saved.locator('header').boundingBox();
  const atEnd = await saved.evaluate((column) => {
    const list = column.querySelector('ul') as HTMLElement;
    list.scrollTop = list.scrollHeight;
    const head = column.querySelector('header') as HTMLElement;
    const box = head.getBoundingClientRect();
    const cards = [...list.querySelectorAll('li')];
    return {
      headerTop: box.top,
      headerHit: head.contains(document.elementFromPoint(box.left + 20, box.top + box.height / 2)),
      lastCardOverhang:
        (cards.at(-1)?.getBoundingClientRect().bottom ?? 0) - list.getBoundingClientRect().bottom,
    };
  });
  expect.soft(atEnd.headerTop, 'the header has not moved').toBeCloseTo(header?.y ?? Number.NaN, 0);
  expect.soft(atEnd.headerHit, 'the header is drawn over nothing').toBe(true);
  expect.soft(atEnd.lastCardOverhang, 'the last card is not cut off').toBeLessThanOrEqual(0.5);

  const board = page.getByTestId('kanban-board');
  await page
    .getByRole('navigation', { name: 'Jump to column' })
    .getByRole('button', { name: /^Withdrawn/ })
    .click();
  await expect
    .poll(
      async () => {
        const [frame, column] = [
          await board.boundingBox(),
          await page.getByTestId('column-withdrawn').boundingBox(),
        ];
        return frame && column ? column.x + column.width <= frame.x + frame.width + 0.5 : false;
      },
      { message: 'Withdrawn is scrolled fully into the board' },
    )
    .toBe(true);

  await board.evaluate((element) => {
    element.scrollLeft = 0;
    (element.querySelector('[data-testid="column-saved"] ul') as HTMLElement).scrollTop = 0;
  });
  const applied = await page.getByTestId('column-applied').boundingBox();
  if (!applied) throw new Error('The Applied column has no layout box');
  const [overX, overY] = [applied.x + applied.width / 2, applied.y + 120];
  // The top card: the list is newest first, so "Saved 1" is below its visible part.
  await pickUp(page, saved.getByRole('button', { name: /^Move / }).first(), overX, overY);
  const drawn = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-drag-preview]') !== null,
    [overX, overY],
  );
  expect.soft(drawn, 'the dragged card is drawn over the next column').toBe(true);

  const list = await saved.locator('ul').boundingBox();
  if (!list) throw new Error('The Saved list has no layout box');
  const listTop = (): Promise<number> =>
    saved.locator('ul').evaluate((element) => element.scrollTop);
  const startTop = await listTop();
  await page.mouse.move(list.x + list.width / 2, list.y + list.height - 6, { steps: 10 });
  await expect
    .poll(listTop, { message: 'holding the card at the list bottom scrolls the list' })
    .toBeGreaterThan(startTop);
  await page.keyboard.press('Escape');
  await page.mouse.up();

  for (const [width, height] of [
    [844, 390],
    [375, 812],
  ]) {
    await page.setViewportSize({ width, height });
    const flowing = await geometry(page);
    const at = `${String(width)}x${String(height)}`;
    expect.soft(flowing.listScrolls, `${at}: no scroll inside a column`).toBe(false);
    expect.soft(flowing.pageOverflow, `${at}: the page scrolls past the board`).toBeGreaterThan(0);
  }
});
