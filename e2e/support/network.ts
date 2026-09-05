import { test as base, type BrowserContext, type Page } from '@playwright/test';

/**
 * Every limiter the API mounts is keyed on `req.ip`: the credential ones at five
 * attempts per fifteen minutes, and the blanket one at two hundred requests in
 * the same window. All the suite's traffic leaves one machine, so on one address
 * the sixth sign-in of a run is a 429 and a route-sweeping audit exhausts the
 * global budget on its own — and because the window is fifteen minutes and the
 * counters live in the API process, the *second* consecutive run starts already
 * spent. That last part matters most: this phase's bar is three clean runs in a
 * row, which is unreachable if run two inherits run one's counters.
 *
 * So the E2E API runs with `TRUST_PROXY=1`, making `req.ip` the last
 * `X-Forwarded-For` entry, and every test declares its own synthetic address:
 *
 *     10.<run>.<file>.<test>
 *
 * `<run>` is randomised per invocation, so no run inherits another's counters.
 * `<file>` and `<test>` keep concurrent and sequential tests off each other's
 * budget. The limiters are still fully enforced — per synthetic client instead
 * of collapsed onto one — and the limiting behaviour itself is covered by the
 * server suite, not here.
 *
 * `10.0.0.0/8` is private space no real client could arrive from.
 */
const RUN_OCTET = process.env.E2E_RUN_OCTET ?? '77';

/** Small, stable, and spread across the octet range; only distinctness matters. */
function octet(value: string): number {
  let hash = 7;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 251;
  }

  return hash + 1;
}

export function clientAddress(file: number, test = 'setup'): string {
  return `10.${RUN_OCTET}.${String(file)}.${String(octet(test))}`;
}

interface Fixtures {
  page: Page;
  context: BrowserContext;
}

/**
 * Builds a `test` whose every request carries this file's synthetic address.
 *
 * `extraHTTPHeaders` is set on the context so it reaches document navigations
 * and the SPA's own XHRs alike: if only one of them carried the header, a page
 * load and its data would be counted against two different buckets and the
 * budget would halve.
 */
export function testForClient(file: number) {
  return base.extend<Fixtures>({
    context: async ({ browser }, use, testInfo) => {
      const context = await browser.newContext({
        extraHTTPHeaders: {
          'X-Forwarded-For': clientAddress(file, testInfo.titlePath.join(' ')),
        },
      });

      await use(context);
      await context.close();
    },
    page: async ({ context }, use) => {
      const page = await context.newPage();
      await use(page);
    },
  });
}
