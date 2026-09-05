import { expect, type Locator, type Page } from '@playwright/test';
import { apiFor, createApplication, newAccount, registerAccount } from '../support/api';
import { testForClient } from '../support/network';
import { signIn } from '../support/ui';

const test = testForClient(3);

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
async function dragCardTo(page: Page, handle: Locator, column: Locator): Promise<void> {
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
 * SPEC section 10, flow 3: drag a card to another column, reload, and find the
 * status persisted.
 *
 * The reload is the whole point. The board writes optimistically, so the card
 * moves on screen before the server has agreed; only a reload proves the PATCH
 * landed rather than the optimistic patch still sitting in the cache.
 */
test('drag a card to another column and the status survives a reload', async ({ page }) => {
  const account = newAccount('drag');
  const api = await apiFor(3);
  const { accessToken } = await registerAccount(api, account);
  await createApplication(api, accessToken, {
    company: 'Cloudflare',
    role: 'Platform Intern',
    status: 'saved',
  });
  await api.dispose();

  await signIn(page, account);
  await page.goto('/applications/board');

  const savedColumn = page.getByTestId('column-saved');
  const interviewColumn = page.getByTestId('column-interview');
  await expect(savedColumn.getByText('Cloudflare')).toBeVisible();

  const handle = page.getByRole('button', { name: /^Move Cloudflare/ });
  await dragCardTo(page, handle, interviewColumn);

  await expect(interviewColumn.getByText('Cloudflare')).toBeVisible();

  await page.reload();

  await expect(page.getByTestId('column-interview').getByText('Cloudflare')).toBeVisible();
  await expect(page.getByTestId('column-saved').getByText('Cloudflare')).toHaveCount(0);
});
