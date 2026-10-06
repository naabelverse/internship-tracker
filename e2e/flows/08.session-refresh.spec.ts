// Client address 8: 1 of 5 sign-ups per 15 minutes.
import { expect } from '@playwright/test';
import { apiFor, createApplication, newAccount, registerAccount } from '../support/api';
import { testForClient } from '../support/network';
import { expectNoVisibleError, signIn } from '../support/ui';

const test = testForClient(8);

/**
 * SPEC section 10, flow 8: the access token stops working, a request is made,
 * and the silent refresh recovers it without the user seeing an error.
 *
 * The token lives in memory only — SPEC section 7 requires that — so there is no
 * storage entry a test could delete, and adding a hook to reach into the store
 * would mean shipping a test seam in production code. Invalidating the token on
 * the wire instead produces exactly the condition the flow is about: the server
 * genuinely rejects the request with a 401, the axios interceptor genuinely
 * refreshes, and the replay genuinely succeeds. The header is rewritten for one
 * request only, so the replay carries the real token.
 */
test('an expired access token is refreshed silently, with no error on screen', async ({ page }) => {
  const account = newAccount('refresh');
  const api = await apiFor(8);
  const { accessToken } = await registerAccount(api, account);
  await createApplication(api, accessToken, { company: 'Airbnb', role: 'Frontend Intern' });
  await api.dispose();

  await signIn(page, account);

  const refreshes: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/auth/refresh')) refreshes.push(request.url());
  });
  const before = refreshes.length;

  // Break exactly one request's credential.
  let broken = false;
  // A predicate rather than a glob: the list URL carries a query string, and
  // `?` is a wildcard in Playwright's glob syntax, so the pattern silently
  // matched nothing and the first run reported "the intercept never fired".
  await page.route(
    (url) => url.pathname === '/api/v1/applications',
    async (route) => {
      if (broken) {
        await route.fallback();
        return;
      }

      broken = true;
      await route.fallback({
        headers: { ...route.request().headers(), authorization: 'Bearer expired.token.value' },
      });
    },
  );

  await page.goto('/applications');

  // The list still arrives, which can only happen through the refresh and replay.
  await expect(page.getByRole('heading', { level: 1, name: 'Applications' })).toBeVisible();
  await expect(page.getByText('Airbnb')).toBeVisible();

  expect(broken, 'the intercept never fired, so nothing was actually expired').toBe(true);
  expect(refreshes.length, 'no silent refresh was attempted').toBeGreaterThan(before);

  // And the user was never told about any of it.
  await expectNoVisibleError(page);
  await expect(page).toHaveURL(/\/applications/);
});
