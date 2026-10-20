import { expect, type Locator, type Page } from '@playwright/test';
import type { TestAccount } from './api';

/**
 * Drags a card onto a column with a real pointer.
 *
 * dnd-kit's `PointerSensor` has a 4 px activation distance and measures
 * droppables through `getBoundingClientRect`, so the move has to be a genuine
 * sequence of pointer positions rather than one jump: a single `mouse.move`
 * lands the pointer without ever crossing the activation threshold, and the drag
 * never starts. The intermediate steps are what make this exercise the same code
 * path a user does.
 *
 * The board scrolls sideways, and dnd-kit auto-scrolls it while the pointer is
 * within 20% of its edge. Aiming straight at a column that starts off-screen
 * parks the pointer in that band, the board slides under it, and the drop lands
 * on whichever column happens to be there on release (CI run 39348336975 put
 * Cloudflare in Offer instead of Interview). So this does what a user does: hold
 * at the edge until the target column is clear of the band, or the board can
 * scroll no further, and only then move onto it and let go.
 */
export async function dragCardTo(page: Page, handle: Locator, column: Locator): Promise<void> {
  const board = page.getByTestId('kanban-board');
  await handle.scrollIntoViewIfNeeded();
  const from = await handle.boundingBox();
  const area = await board.boundingBox();
  if (!from || !area) throw new Error('Card or board has no layout box');

  const startX = from.x + from.width / 2;
  const startY = from.y + from.height / 2;
  // A quarter rather than dnd-kit's fifth, so the pointer is never on the line.
  const inset = area.width / 4;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Past the activation constraint first, then across in steps.
  await page.mouse.move(startX + 8, startY, { steps: 4 });

  for (let tick = 0; tick < 100; tick += 1) {
    const to = await column.boundingBox();
    if (!to) throw new Error('Column has no layout box');
    const { scrollLeft, maxScroll } = await board.evaluate((element) => ({
      scrollLeft: element.scrollLeft,
      maxScroll: element.scrollWidth - element.clientWidth,
    }));

    const centreX = to.x + to.width / 2;
    const endY = to.y + 80;

    if (centreX < area.x + inset && scrollLeft > 0) {
      await page.mouse.move(area.x + 4, endY, { steps: 5 });
    } else if (centreX > area.x + area.width - inset && scrollLeft < maxScroll - 1) {
      await page.mouse.move(area.x + area.width - 4, endY, { steps: 5 });
    } else {
      await page.mouse.move(centreX, endY, { steps: 10 });
      await page.mouse.up();
      return;
    }

    await page.waitForTimeout(50);
  }

  throw new Error('The target column never scrolled clear of the board edge');
}

/**
 * Signs in through the real form, which is what flows about the session need:
 * seeding a token straight into the store would skip the cookie the silent
 * refresh depends on.
 */
export async function signIn(page: Page, account: TestAccount): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

/**
 * Asserts nothing failed in a way the user would see.
 *
 * `react-hot-toast` renders errors into a live region, and every error surface
 * in the app uses `role="alert"`. Several flows are specifically about a failure
 * *not* being shown — the silent refresh most of all — so this is the shared
 * definition of "no visible error" rather than eight slightly different ones.
 */
export async function expectNoVisibleError(page: Page): Promise<void> {
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(/something went wrong|could not be loaded/i)).toHaveCount(0);
}
