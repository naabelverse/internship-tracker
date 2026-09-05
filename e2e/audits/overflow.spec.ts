import { expect, type Page } from '@playwright/test';
import { apiFor, createApplication, newAccount, registerAccount } from '../support/api';
import { testForClient } from '../support/network';
import {
  bisectOverflow,
  containmentChain,
  measureOverflow,
  overflowWithout,
} from '../support/overflow';
import { signIn } from '../support/ui';

const test = testForClient(10);

/**
 * SPEC section 17: the app must be usable and look correct at 375, 768 and
 * 1440 px. Phase 9 verified most of that in a real browser but left the board
 * route scrolling sideways at every width, and applications at 768, with the
 * root cause not isolated.
 *
 * This is the check that keeps it fixed, and the report it prints is what
 * isolated it in the first place.
 */
const WIDTHS = [375, 768, 1440] as const;

const ROUTES = [
  { path: '/', label: 'landing', protected: false },
  { path: '/login', label: 'login', protected: false },
  { path: '/dashboard', label: 'dashboard', protected: true },
  { path: '/applications', label: 'applications', protected: true },
  { path: '/applications/board', label: 'board', protected: true },
  { path: '/applications/calendar', label: 'calendar', protected: true },
  { path: '/settings', label: 'settings', protected: true },
] as const;

async function reportOverflow(page: Page, label: string, width: number): Promise<number> {
  const measured = await measureOverflow(page);

  const header =
    `${label} @ ${String(width)}px — ` +
    `doc ${String(measured.docScrollWidth)}/${String(measured.docClientWidth)}, ` +
    `body ${String(measured.bodyScrollWidth)}/${String(measured.bodyClientWidth)}, ` +
    `scrolled ${String(measured.scrolledBy)}px`;

  // The verdict is the attempted scroll, not the box scan. Whether the document
  // scrolls is a fact about the document, and `scrollLeft` answers it directly;
  // the box list exists to say *why* when it does, and reading a verdict off it
  // instead is how a fixed, off-canvas drawer gets mistaken for an overflow.
  const overflows = measured.scrolledBy !== 0 || measured.docScrollWidth > measured.docClientWidth;

  if (!overflows) {
    console.log(`  OK   ${header}`);
    return measured.scrolledBy;
  }

  console.log(`  OVER ${header}`);

  // Ask the browser which element owns the width before reading the rect scan,
  // which is a heuristic and can legitimately come back empty.
  const trail = await bisectOverflow(page);
  console.log(
    trail.length > 0
      ? `         owns the overflow: ${trail.join(' > ')}`
      : '         bisection found no single element; the overflow is on body itself',
  );

  if (trail.length > 0) {
    const leaf = trail[trail.length - 1] ?? '';
    for (const row of await containmentChain(page, leaf.split(' [')[0] ?? leaf)) {
      console.log(`           ${row}`);
    }
  }
  for (const node of measured.offenders.slice(0, 12)) {
    console.log(
      `         ${node.path}` +
        `\n           right=${String(node.right)} left=${String(node.left)} ` +
        `width=${String(node.width)} position=${node.position} ` +
        `overflow-x=${node.overflowX} transform=${node.transform}` +
        (node.testId ? `\n           data-testid=${node.testId}` : ''),
    );
    const without = await overflowWithout(page, node.path);
    console.log(`           document scrollWidth without it: ${String(without)}`);
  }

  return measured.scrolledBy;
}

/**
 * One test per width rather than one loop over three.
 *
 * Each test gets its own synthetic client address, and so its own rate-limit
 * budget: sweeping seven routes at three widths in a single test puts about a
 * hundred and fifty requests on one address, against a blanket limit of two
 * hundred in fifteen minutes. Split, no test comes close, and a failure names
 * the width it happened at without reading the log.
 */
for (const width of WIDTHS) {
  test(`no route scrolls the document sideways at ${String(width)}px`, async ({ page }) => {
    const account = newAccount(`overflow-${String(width)}`);
    const api = await apiFor(10);
    const { accessToken } = await registerAccount(api, account);
    /*
      Deliberately wide, and spread across statuses.

      Both halves matter. The table and the board only overflow their own
      containers once the content is wider than they are, and that is the only
      condition under which an escaping `sr-only` box lands past the viewport —
      the defect this audit exists to catch. With short names and one status the
      table fits at 768 and the right-hand board columns are empty, so the page
      looks clean for the wrong reason: CI caught the original bug only because
      its fonts happened to be wider than the local ones, which is luck, not a
      test. Long strings and a card in the last column make it deterministic.
    */
    const statuses = ['saved', 'applied', 'assessment', 'interview', 'offer'];
    for (const [index, status] of statuses.entries()) {
      await createApplication(api, accessToken, {
        company: `A Deliberately Long Company Name Number ${String(index)}`,
        role: 'An Extremely Long Role Title That Widens The Table Layout',
        status,
      });
    }
    await api.dispose();

    await page.setViewportSize({ width, height: 900 });
    await signIn(page, account);

    const failures: string[] = [];
    console.log(`
viewport ${String(width)}px`);

    for (const route of ROUTES) {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      // Layout settles a frame after the route paints; measuring in the same
      // frame reads boxes that have not been placed yet.
      await page.waitForTimeout(250);

      const scrolledBy = await reportOverflow(page, route.label, width);
      if (scrolledBy !== 0) failures.push(`${route.label} @ ${String(width)}px`);
    }

    expect(failures, 'these routes scroll the document horizontally').toEqual([]);
  });
}
