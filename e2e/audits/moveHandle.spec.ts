// Client address 19: 1 of 5 sign-ups per 15 minutes.
import { expect, type Page } from '@playwright/test';
import { apiFor, createApplication, newAccount, registerAccount } from '../support/api';
import { testForClient } from '../support/network';
import { signIn } from '../support/ui';

const test = testForClient(19);

/** The computed cursor on the body, the account's one card, and a link outside the board. */
async function cursors(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const card = document.querySelector('li[data-card-id]');
    const link = document.querySelector('#app-navigation a');
    if (!card || !link) throw new Error('The card or the sidebar link is missing');
    return {
      body: getComputedStyle(document.body).cursor,
      card: getComputedStyle(card).cursor,
      link: getComputedStyle(link).cursor,
    };
  });
}

/** The `column-<status>` test id of the column the card sits in. */
async function cardColumn(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      document.querySelector('li[data-card-id]')?.closest('section')?.getAttribute('data-testid') ??
      '',
  );
}

const previewGone = (page: Page): Promise<void> =>
  expect(page.locator('[data-drag-preview]')).toHaveCount(0);

/**
 * The cursors jsdom cannot compute.
 *
 * - The Move handle shows `grab`; the rest of the card does not, because only
 *   the handle drags.
 * - The handle has `touch-action: none`, and the drag preview follows the
 *   pointer with no offset.
 * - Mid-drag every element shows `grabbing` (the pointer is over the preview,
 *   not the handle), and each element gets its own cursor back however the
 *   drag ends: Escape, a release over the page header, a drop in a column.
 *
 * A release over the header is not a cancel: collision detection falls back to
 * the nearest column, so the card can land in one. The test only asks where it
 * is afterwards, so it does not pin that behaviour either way.
 */
test('the Move handle shows grab, a drag shows grabbing, and every ending clears it', async ({
  page,
}) => {
  const account = newAccount('handle');
  const api = await apiFor(19);
  const { accessToken } = await registerAccount(api, account);
  await createApplication(api, accessToken, {
    company: 'Handle card',
    role: 'Intern',
    status: 'saved',
  });
  await api.dispose();

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, account);
  await page.goto('/applications/board');

  const handle = page.getByRole('button', { name: /^Move Handle card from / });
  await expect(handle).toHaveAccessibleName('Move Handle card from Saved');

  expect(await handle.evaluate((element) => getComputedStyle(element).cursor)).toBe('grab');
  // Issue #95: with `touch-action: auto` a finger on the handle was taken for a
  // pan and the drag was cancelled before it started.
  expect(await handle.evaluate((element) => getComputedStyle(element).touchAction)).toBe('none');
  const resting = await cursors(page);

  // Issue #94: the copy follows the pointer exactly. It sat 20px lower while it
  // was rendered inside the page's `space-y-5` and took its margin.
  const cardBox = await page.locator('li[data-card-id]').boundingBox();
  const handleBox = await handle.boundingBox();
  if (!cardBox || !handleBox) throw new Error('The card has no layout box');
  const pressAt = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
  await page.mouse.move(pressAt.x, pressAt.y);
  await page.mouse.down();
  await page.mouse.move(pressAt.x + 8, pressAt.y, { steps: 2 });
  await page.mouse.move(pressAt.x + 60, pressAt.y + 40, { steps: 8 });
  const previewBox = await page.locator('[data-drag-preview]').boundingBox();
  expect.soft(previewBox?.x, 'preview x after +60').toBeCloseTo(cardBox.x + 60, 0);
  expect.soft(previewBox?.y, 'preview y after +40').toBeCloseTo(cardBox.y + 40, 0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await previewGone(page);
  expect(resting.card).not.toBe('grab');
  expect(resting.card).not.toBe('grabbing');

  /** Presses the handle and carries it to a point, past dnd-kit's 4 px activation. */
  async function dragTo(x: number, y: number): Promise<void> {
    const box = await handle.boundingBox();
    if (!box) throw new Error('The Move handle has no layout box');
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 8, start.y, { steps: 4 });
    await page.mouse.move(x, y, { steps: 15 });
    await expect(page.locator('[data-drag-preview]')).toHaveCount(1);
    expect(await cursors(page)).toEqual({ body: 'grabbing', card: 'grabbing', link: 'grabbing' });
  }

  /** A point well inside a column's card list. */
  async function inside(testId: string): Promise<[number, number]> {
    const box = await page.getByTestId(testId).boundingBox();
    if (!box) throw new Error(`${testId} has no layout box`);
    return [box.x + box.width / 2, box.y + 120];
  }

  await dragTo(...(await inside('column-applied')));
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await previewGone(page);
  expect(await cursors(page), 'after Escape').toEqual(resting);

  const heading = await page.getByRole('heading', { level: 1, name: 'Board' }).boundingBox();
  if (!heading) throw new Error('The page heading has no layout box');
  await dragTo(heading.x + heading.width / 2, heading.y + heading.height / 2);
  await page.mouse.up();
  await previewGone(page);
  expect(await cursors(page), 'after a release over the page header').toEqual(resting);

  const target = (await cardColumn(page)) === 'column-applied' ? 'column-saved' : 'column-applied';
  await dragTo(...(await inside(target)));
  await page.mouse.up();
  await previewGone(page);
  await expect(page.getByTestId(target).getByText('Handle card')).toBeVisible();
  expect(await cursors(page), 'after a drop in a column').toEqual(resting);
});
