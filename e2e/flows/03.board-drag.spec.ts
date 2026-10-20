// Client address 3: 1 of 5 sign-ups per 15 minutes.
import { expect } from '@playwright/test';
import { apiFor, createApplication, newAccount, registerAccount } from '../support/api';
import { testForClient } from '../support/network';
import { dragCardTo, signIn } from '../support/ui';

const test = testForClient(3);

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
