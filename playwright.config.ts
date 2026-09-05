import { defineConfig, devices } from '@playwright/test';

/**
 * SPEC section 10's end-to-end suite, run against a real stack.
 *
 * The stack is the compose one — `npm run e2e:up` — rather than a `webServer`
 * Playwright starts itself. That is the point of these tests: unit tests already
 * cover the components, and what is left to prove is the part only a real
 * deployment has, which is a real API, a real Mongo, a real cookie crossing a
 * real origin boundary. Bringing up Vite in-process would test none of that.
 *
 * The E2E stack runs on shifted ports (5174 web, 5001 api) under its own compose
 * project, so it never collides with a development stack somebody has running.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5174';

/**
 * One random octet per invocation, inherited by every worker process.
 *
 * The API's rate-limit counters are in-memory with a fifteen-minute window, so
 * without this the second consecutive run would start with the first run's
 * budget already spent — and three consecutive clean runs is the bar this phase
 * has to clear. See `e2e/support/network.ts`.
 */
process.env.E2E_RUN_OCTET ??= String(Math.floor(Math.random() * 250) + 1);

export default defineConfig({
  testDir: './e2e',
  // Every flow signs in, and the credential limiters are per-client. Serial
  // execution keeps the synthetic client addresses in `support/network.ts`
  // one-to-one with files rather than racing over them, and keeps the mail log
  // readable: two registrations in flight would interleave in the API output.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // A retry hides exactly the intermittency this suite exists to catch. The
  // stability bar here is three clean consecutive runs, not a green retry.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Chromium alone. SPEC section 10 asks for the flows, not a browser matrix,
    // and a second engine would triple the run for no new failure mode here.
    ...devices['Desktop Chrome'],
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
