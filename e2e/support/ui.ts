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
 */
export async function dragCardTo(page: Page, handle: Locator, column: Locator): Promise<void> {
  const from = await handle.boundingBox();
  const to = await column.boundingBox();
  if (!from || !to) throw new Error('Card or column has no layout box');

  const startX = from.x + from.width / 2;
  const startY = from.y + from.height / 2;
  const endX = to.x + to.width / 2;
  const endY = to.y + 80;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Past the activation constraint first, then across in steps.
  await page.mouse.move(startX + 8, startY, { steps: 4 });
  await page.mouse.move(endX, endY, { steps: 20 });
  await page.mouse.up();
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
