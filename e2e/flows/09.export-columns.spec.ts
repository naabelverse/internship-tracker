// Client address 15: 1 of 5 sign-ups per 15 minutes.
import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { apiFor, createApplication, newAccount, registerAccount } from '../support/api';
import { testForClient } from '../support/network';
import { signIn } from '../support/ui';

const test = testForClient(15);

const ALL_FIELDS_HEADER =
  'company,role,status,priority,source,sourceOther,workMode,employmentType,location,jobUrl,' +
  'companyWebsite,appliedDate,deadline,tags,notes,resumeVersion,stipendAmount,' +
  'stipendCurrency,stipendPeriod,contactName,contactEmail,archived,createdAt';

/** Picks one Export CSV choice and returns the downloaded file's rows, header first. */
async function exportChoice(page: Page, choice: string): Promise<string[][]> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  await page.getByRole('menuitem', { name: choice }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^applications-\d{4}-\d{2}-\d{2}\.csv$/);
  const contents = await readFile(await download.path(), 'utf8');
  // The seeded values contain no commas, quotes or newlines, so a plain split
  // is an exact parse here.
  return contents
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(','));
}

/**
 * Export CSV's two choices, read back from the files the browser actually saves:
 * "Shown columns" carries the table's visible columns (Source bringing
 * sourceOther), and "All fields" is the full export, header and all.
 */
test('Shown columns follows the Columns menu, and All fields is the full export', async ({
  page,
}) => {
  const account = newAccount('columns');
  const api = await apiFor(15);
  const { accessToken } = await registerAccount(api, account);
  await createApplication(api, accessToken, {
    company: 'Grab',
    role: 'Data Intern',
    source: 'other',
    sourceOther: 'Career fair',
    tags: ['sql'],
  });
  await api.dispose();

  await signIn(page, account);
  await page.goto('/applications');
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();

  // The default columns: Location and Source hidden.
  const [defaultHeader, defaultRow] = await exportChoice(page, 'Shown columns (7)');
  expect(defaultHeader).toEqual([
    'company',
    'role',
    'status',
    'priority',
    'appliedDate',
    'deadline',
    'tags',
  ]);
  expect(defaultRow?.slice(0, 4)).toEqual(['Grab', 'Data Intern', 'saved', 'medium']);
  expect(defaultRow?.[6]).toBe('sql');

  // Switch Source on: the file gains source and the "please specify" text.
  await page.getByRole('button', { name: /^Columns/ }).click();
  await page.getByRole('checkbox', { name: 'Source' }).check();
  await page.keyboard.press('Escape');
  const [sourceHeader, sourceRow] = await exportChoice(page, 'Shown columns (8)');
  expect(sourceHeader).toEqual([
    'company',
    'role',
    'status',
    'priority',
    'source',
    'sourceOther',
    'appliedDate',
    'deadline',
    'tags',
  ]);
  expect(sourceRow?.slice(4, 6)).toEqual(['other', 'Career fair']);

  // All fields ignores the column choice entirely.
  const [allHeader, allRow] = await exportChoice(page, 'All fields');
  expect(allHeader?.join(',')).toBe(ALL_FIELDS_HEADER);
  expect(allRow?.slice(0, 6)).toEqual([
    'Grab',
    'Data Intern',
    'saved',
    'medium',
    'other',
    'Career fair',
  ]);
});
