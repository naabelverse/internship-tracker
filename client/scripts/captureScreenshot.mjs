import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/**
 * Captures the dashboard screenshot the landing page shows.
 *
 * It is a real screenshot of the real app signed into the real demo account,
 * taken against a production build — not a mock-up. That matters: the landing
 * page claims "the same view the demo account opens on", and a hand-drawn
 * approximation would make that claim false the moment the UI changed.
 *
 * Run it with the stack up:
 *   npm run seed:reset -w server
 *   npm run build -w client && npx vite preview --port 4173
 *   node scripts/captureScreenshot.mjs
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(here, '..', 'public', 'screenshot-dashboard.png');

const appUrl = process.env.SCREENSHOT_URL ?? 'http://localhost:4173';

const browser = await chromium.launch({ channel: 'msedge' });

try {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 700 },
    // Retina density, so the image stays crisp at its rendered width on the
    // landing page. The <img> declares 2400x1400 to match.
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });

  const page = await context.newPage();

  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await page.waitForURL('**/dashboard');

  // The charts animate in, so wait for them to settle rather than racing them.
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
  await page.waitForTimeout(2500);

  await page.screenshot({ path: outputPath });

  console.log(`Screenshot written to ${outputPath}`);
} finally {
  await browser.close();
}
