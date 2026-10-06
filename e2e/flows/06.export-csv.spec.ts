// Client address 6: 1 of 5 sign-ups per 15 minutes.
import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { apiFor, createApplication, newAccount, registerAccount } from '../support/api';
import { testForClient } from '../support/network';
import { signIn } from '../support/ui';

const test = testForClient(6);

/**
 * SPEC section 10, flow 6: export the CSV and check the header row.
 *
 * Phase 15 found the endpoint had shipped in Phase 4 with nothing in the UI
 * calling it, so this flow could not be walked at all. The toolbar control was
 * added for it; this proves the file the browser actually receives, not just
 * that a request was made.
 */
test('export the applications CSV and get the expected header row', async ({ page }) => {
  const account = newAccount('export');
  const api = await apiFor(6);
  const { accessToken } = await registerAccount(api, account);
  await createApplication(api, accessToken, {
    company: 'Deliveroo',
    role: 'Data Intern',
    status: 'applied',
  });
  await api.dispose();

  await signIn(page, account);
  await page.goto('/applications');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^applications-\d{4}-\d{2}-\d{2}\.csv$/);

  const path = await download.path();
  const contents = await readFile(path, 'utf8');
  const [header, ...rows] = contents.trim().split(/\r?\n/);

  // The exact column list the server exports, in order.
  expect(header).toBe(
    'company,role,status,priority,source,sourceOther,workMode,employmentType,location,jobUrl,' +
      'companyWebsite,appliedDate,deadline,tags,notes,resumeVersion,stipendAmount,' +
      'stipendCurrency,stipendPeriod,contactName,contactEmail,archived,createdAt',
  );
  expect(rows[0]).toContain('Deliveroo');
});
