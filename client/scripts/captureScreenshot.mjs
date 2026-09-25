import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/**
 * Captures the dashboard screenshots the landing page shows, one per theme.
 *
 * They are real screenshots of the real app signed into the real demo account,
 * taken against a production build — not a mock-up. That matters: the landing
 * page claims "the same view the demo account opens on", and a hand-drawn
 * approximation would make that claim false the moment the UI changed.
 *
 * Alongside the images it writes `dashboardScreenshot.json`: the pixel size the
 * landing page's <img> declares, and the stat-card labels read off the page at
 * capture time. `tests/marketing/dashboardScreenshot.test.tsx` compares those
 * labels with what `StatCards` renders today, so a change to the dashboard's
 * cards fails the suite until the screenshots are recaptured.
 *
 * Run it with the stack up:
 *   npm run seed:reset -w server
 *   npm run build -w client && npx vite preview --port 4173
 *   node scripts/captureScreenshot.mjs
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');
const manifestPath = path.join(
  here,
  '..',
  'src',
  'components',
  'marketing',
  'dashboardScreenshot.json',
);

const appUrl = process.env.SCREENSHOT_URL ?? 'http://localhost:4173';

/*
  1280 is Tailwind's `xl`, where the stat cards go from 2 x 4 to 4 x 2. Any
  narrower and the eight cards take four rows, pushing the chart and the
  upcoming list out of frame.
*/
const viewport = { width: 1280, height: 760 };
// Retina density, so the image stays crisp at its rendered width on the landing page.
const deviceScaleFactor = 2;

const THEMES = [
  { name: 'light', control: 'Light theme' },
  { name: 'dark', control: 'Dark theme' },
];

const browser = await chromium.launch({ channel: 'msedge' });

try {
  const context = await browser.newContext({ viewport, deviceScaleFactor });
  const page = await context.newPage();

  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await page.waitForURL('**/dashboard');
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor();

  // The sign-in toast would otherwise sit in the first frame.
  await page.waitForTimeout(5000);

  /*
    Pick each theme through the control rather than through `colorScheme`.

    `colorScheme` only decides what `system` resolves to, and the demo account
    carries its own stored preference which wins the moment the session loads --
    so the context setting alone produced whichever theme that account happened
    to hold, and the capture was not reproducible. Clicking the control makes it
    explicit, and leaves the matching segment selected in each frame.
  */
  for (const theme of THEMES) {
    await page.getByRole('radio', { name: theme.control }).click();
    await page.waitForSelector(`html[data-theme='${theme.name}']`);
    // The charts read their colours at paint time and animate in; let them settle.
    await page.waitForTimeout(2500);

    const outputPath = path.join(publicDir, `screenshot-dashboard-${theme.name}.png`);
    await page.screenshot({ path: outputPath });
    console.log(`Screenshot written to ${outputPath}`);
  }

  // Each stat card is a direct child of the grid, and its first paragraph is its label.
  const statCards = await page
    .locator('main p', { hasText: /^Total$/ })
    .first()
    .evaluate((total) => {
      const grid = total.closest('.grid');
      if (!grid) throw new Error('Could not find the stat-card grid on the dashboard.');
      return [...grid.children].map((card) => card.querySelector('p')?.textContent?.trim() ?? '');
    });

  const manifest = {
    width: viewport.width * deviceScaleFactor,
    height: viewport.height * deviceScaleFactor,
    statCards,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Manifest written to ${manifestPath}`);
} finally {
  await browser.close();
}
