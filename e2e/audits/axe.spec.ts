import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import type { Result } from 'axe-core';
import { apiFor, createApplication, newAccount, registerAccount } from '../support/api';
import { testForClient } from '../support/network';
import { signIn } from '../support/ui';

const test = testForClient(9);

/**
 * SPEC section 10's accessibility gate: zero critical or serious violations on
 * the landing page, login, dashboard, board and the create-application modal,
 * with the report printed.
 *
 * Everything axe finds is printed, not only what fails the gate. Phase 9 found
 * four real compliance gaps that had been assumed fixed, so a bare pass/fail
 * here would be worth very little — the moderate and minor findings are the ones
 * that turn into the next phase's serious ones.
 */
const GATE: readonly string[] = ['critical', 'serious'];

function report(label: string, violations: Result[]): void {
  const line = `axe — ${label}`;
  if (violations.length === 0) {
    console.log(`\n${line}: no violations at any impact level.`);
    return;
  }

  console.log(`\n${line}: ${String(violations.length)} violation type(s)`);
  for (const violation of violations) {
    console.log(
      `  [${violation.impact ?? 'unknown'}] ${violation.id} — ${violation.help} ` +
        `(${String(violation.nodes.length)} node(s))`,
    );
    console.log(`      ${violation.helpUrl}`);
    for (const node of violation.nodes.slice(0, 5)) {
      console.log(`      at ${node.target.join(' ')}`);
      if (node.failureSummary) {
        console.log(`         ${node.failureSummary.replace(/\n/g, '\n         ')}`);
      }
    }
  }
}

async function audit(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  report(label, results.violations);

  const blocking = results.violations.filter((violation) =>
    GATE.includes(violation.impact ?? 'unknown'),
  );

  expect(
    blocking.map((violation) => `${violation.impact ?? '?'}: ${violation.id}`),
    `${label} has critical or serious accessibility violations`,
  ).toEqual([]);
}

test.describe('accessibility', () => {
  test('the landing page and login are clean', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await audit(page, 'landing (/)');

    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await audit(page, 'login (/login)');
  });

  /*
    The legal pages sat outside this list until the `.prose-legal` fix, which is
    what made them worth adding: they render markdown from the repository
    through `dangerouslySetInnerHTML`, so their heading hierarchy comes out of a
    content file rather than a component, and nothing else checks it. axe's
    `heading-order` rule is what catches a heading level skipped in a document
    nobody re-reads.
  */
  test('the legal pages are clean', async ({ page }) => {
    await page.goto('/terms');
    await expect(page.getByRole('heading', { level: 1, name: /terms/i })).toBeVisible();
    await audit(page, 'terms (/terms)');

    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 1, name: /privacy/i })).toBeVisible();
    await audit(page, 'privacy (/privacy)');
  });

  test('the dashboard, the board and the create modal are clean', async ({ page }) => {
    const account = newAccount('axe');
    const api = await apiFor(9);
    const { accessToken } = await registerAccount(api, account);
    await createApplication(api, accessToken, {
      company: 'Revolut',
      role: 'Mobile Intern',
      status: 'applied',
    });
    await api.dispose();

    await signIn(page, account);
    // The charts animate on mount; auditing mid-animation reads a half-built DOM.
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await audit(page, 'dashboard (/dashboard)');

    await page.goto('/applications/board');
    await expect(page.getByTestId('kanban-board')).toBeVisible();
    await audit(page, 'board (/applications/board)');

    await page.goto('/applications');
    await page.getByRole('button', { name: 'New application' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await audit(page, 'create-application modal');
  });
});
