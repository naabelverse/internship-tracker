import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Writes `robots.txt` and `sitemap.xml` into `public/` from `VITE_APP_URL`.
 *
 * These two are generated on every build and are **not** committed, unlike the
 * favicons and the OG image next door in `generateBrandAssets.mjs`. The reason
 * is the difference between an asset that depends on the brand and one that
 * depends on the deployment: a favicon is the same file wherever it is served
 * from, while these two hard-code the origin.
 *
 * A committed copy is how `http://localhost:5173` reached production. They were
 * generated once by `npm run assets` with `VITE_APP_URL` unset, the localhost
 * fallback won silently, the result was committed, and Vite copies `public/`
 * byte-for-byte with no substitution — so no amount of setting the variable on
 * the host could ever change them. Generating at build time is what makes the
 * variable actually reach the output.
 *
 * `checkDeployEnv.mjs` is what refuses a deploy build with the variable missing.
 * Here an unset variable means a local build, so it falls back — but says so
 * loudly, because the silent fallback is what hid the original bug.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

const DEV_FALLBACK = 'http://localhost:5173';

/** Kept in step with `src/routes/paths.ts`; a test asserts the two still agree. */
export const INDEXABLE_PATHS = ['/', '/login', '/register', '/terms', '/privacy'];

/** Strips trailing slashes so `${siteUrl}${route}` can never double them. */
export function normaliseSiteUrl(value) {
  return (value ?? DEV_FALLBACK).replace(/\/+$/, '');
}

export function robotsTxt(siteUrl) {
  return [
    'User-agent: *',
    'Allow: /$',
    'Allow: /login',
    'Allow: /register',
    'Allow: /terms',
    'Allow: /privacy',
    '',
    '# Only the routes that carry a single-use token in the query string are',
    '# blocked. The app routes are deliberately *not* listed: they need a session,',
    '# so a crawler gets an empty shell with nothing to index, and Google is',
    '# explicit that robots.txt is the wrong tool for keeping a page out of an',
    '# index anyway. Blocking them would also fail the Lighthouse is-crawlable',
    '# audit for no protection in return.',
    'Disallow: /verify-email',
    'Disallow: /reset-password',
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    '',
  ].join('\n');
}

export function sitemapXml(siteUrl, today = new Date().toISOString().slice(0, 10)) {
  const entries = INDEXABLE_PATHS.map((route) => {
    const location = route === '/' ? siteUrl : `${siteUrl}${route}`;
    const priority = route === '/' ? '1.0' : '0.5';

    return `  <url>\n    <loc>${location}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${priority}</priority>\n  </url>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

async function main() {
  const siteUrl = normaliseSiteUrl(process.env.VITE_APP_URL);

  await writeFile(path.join(publicDir, 'robots.txt'), robotsTxt(siteUrl), 'utf8');
  await writeFile(path.join(publicDir, 'sitemap.xml'), sitemapXml(siteUrl), 'utf8');

  if (siteUrl === DEV_FALLBACK) {
    console.warn(
      `SEO files written with the development fallback ${DEV_FALLBACK}. ` +
        'Set VITE_APP_URL for anything a crawler will see.',
    );
  } else {
    console.log(`SEO files written for ${siteUrl}`);
  }
}

// Importing this for its pure functions must not touch the disk; only running
// it as a script should.
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
