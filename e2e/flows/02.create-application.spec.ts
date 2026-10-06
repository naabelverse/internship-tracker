// Client address 2: 1 of 5 sign-ups per 15 minutes.
import { expect } from '@playwright/test';
import { apiFor, newAccount, registerAccount } from '../support/api';
import { testForClient } from '../support/network';
import { signIn } from '../support/ui';

const test = testForClient(2);

/**
 * SPEC section 10, flow 2: sign in, create an application, and find it both in
 * the table and in the right board column.
 *
 * Both surfaces are checked because they read the same list through different
 * code: the table renders rows straight from the page, the board buckets the
 * same documents by status. A create that reached only one of them would be a
 * real bug and a table-only assertion would miss it.
 */
test('create an application and see it in the table and the right board column', async ({
  page,
}) => {
  const account = newAccount('create');
  const api = await apiFor(2);
  await registerAccount(api, account);
  await api.dispose();

  await signIn(page, account);

  await page.goto('/applications');
  await page.getByRole('button', { name: 'New application' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Company', { exact: true }).fill('Monzo');
  await dialog.getByLabel('Role', { exact: true }).fill('Backend Intern');
  await dialog.getByLabel('Status', { exact: true }).selectOption('applied');
  await dialog.getByRole('button', { name: 'Create application' }).click();

  await expect(dialog).toBeHidden();

  // The row's link, not any text reading "Monzo": the success toast says
  // "Monzo added" and would satisfy a bare text match while proving nothing
  // about the table.
  const row = page.getByRole('link', { name: 'Monzo' });
  await expect(row).toBeVisible();
  await expect(page.getByText('Backend Intern')).toBeVisible();

  await page.goto('/applications/board');
  const appliedColumn = page.getByTestId('column-applied');
  await expect(appliedColumn.getByText('Monzo')).toBeVisible();

  // And nowhere else: a card in two columns would mean the status never took.
  await expect(page.getByTestId('column-saved').getByText('Monzo')).toHaveCount(0);
});
