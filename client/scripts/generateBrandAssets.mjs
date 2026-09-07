import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/**
 * Generates the static brand and SEO assets SPEC section 12 asks for: an
 * `og-image.png`, favicons at the standard sizes, a web manifest, `robots.txt`
 * and `sitemap.xml`.
 *
 * They are generated rather than hand-drawn so the wordmark, the colours and the
 * site URL come from one definition; they are then **committed**, because a
 * favicon that exists only after someone remembers to run a script is a favicon
 * that goes missing. Re-run with `npm run assets -w client` after changing the
 * palette or the site URL.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

/*
  The "Dispatch" palette, kept in step with the tokens in `src/index.css`: the
  jade primary and the petrol canvas of the dark theme, which is the theme the
  app defaults to. Re-run `npm run assets -w client` after changing either.
*/
const BRAND = '#33c9b6';
const INK = '#e3edeb';
const CANVAS = '#0b1315';
const MUTED = '#9aafb2';
const SITE_NAME = 'Internship Tracker';

/** Kept in step with `src/routes/paths.ts`; a test asserts the two still agree. */
const INDEXABLE_PATHS = ['/', '/login', '/register', '/terms', '/privacy'];

const siteUrl = (process.env.VITE_APP_URL ?? 'http://localhost:5173').replace(/\/+$/, '');

/**
 * The square mark: three bars narrowing top to bottom.
 *
 * It is the funnel the product is about - applications, then interviews, then
 * offers - and it is the same shape `BrandMark` draws in the app, rather than
 * the app's initials in a box. Drawn on the 16-unit grid the component uses and
 * scaled by the viewBox, so the two cannot drift.
 */
function markSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16">
  <rect width="16" height="16" rx="3.6" fill="${CANVAS}"/>
  <rect x="3" y="3" width="10" height="2.6" rx="0.7" fill="${BRAND}" opacity="0.55"/>
  <rect x="3" y="6.8" width="6.5" height="2.6" rx="0.7" fill="${BRAND}" opacity="0.78"/>
  <rect x="3" y="10.6" width="3.5" height="2.6" rx="0.7" fill="${BRAND}"/>
</svg>`;
}

function ogImageSvg() {
  const font = 'Helvetica,Arial,sans-serif';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${CANVAS}"/>
  <rect x="0" y="0" width="1200" height="8" fill="${BRAND}"/>

  <rect x="80" y="132" width="64" height="14" rx="4" fill="${BRAND}" opacity="0.55"/>
  <rect x="80" y="153" width="41" height="14" rx="4" fill="${BRAND}" opacity="0.78"/>
  <rect x="80" y="174" width="23" height="14" rx="4" fill="${BRAND}"/>
  <text x="168" y="162" dy="0.35em" font-family="${font}" font-weight="600"
        font-size="32" fill="${INK}">${SITE_NAME}</text>

  <text x="80" y="300" font-family="${font}" font-weight="700" font-size="64" fill="${INK}">Never miss a deadline</text>
  <text x="80" y="376" font-family="${font}" font-weight="700" font-size="64" fill="${INK}">you worked this hard for.</text>

  <text x="80" y="452" font-family="${font}" font-size="28" fill="${MUTED}">A board, a deadline calendar, a morning digest,</text>
  <text x="80" y="492" font-family="${font}" font-size="28" fill="${MUTED}">and real statistics about your search.</text>

  <text x="80" y="558" font-family="${font}" font-weight="600" font-size="24" fill="${BRAND}">Free, open source, and yours to export.</text>
</svg>`;
}

const manifest = {
  name: SITE_NAME,
  short_name: 'Tracker',
  description: 'Track every internship application in one place, and never miss a deadline again.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: CANVAS,
  theme_color: CANVAS,
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

function robotsTxt() {
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

function sitemapXml() {
  const today = new Date().toISOString().slice(0, 10);
  const entries = INDEXABLE_PATHS.map((route) => {
    const location = route === '/' ? siteUrl : `${siteUrl}${route}`;
    const priority = route === '/' ? '1.0' : '0.5';

    return `  <url>\n    <loc>${location}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${priority}</priority>\n  </url>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

async function png(svg, size, name) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(path.join(publicDir, name));
}

async function main() {
  await mkdir(publicDir, { recursive: true });

  await sharp(Buffer.from(ogImageSvg()))
    .png({ compressionLevel: 9 })
    .toFile(path.join(publicDir, 'og-image.png'));

  await writeFile(path.join(publicDir, 'favicon.svg'), markSvg(64), 'utf8');

  for (const [size, name] of [
    [16, 'favicon-16.png'],
    [32, 'favicon-32.png'],
    [180, 'apple-touch-icon.png'],
    [192, 'icon-192.png'],
    [512, 'icon-512.png'],
    [512, 'icon-512-maskable.png'],
  ]) {
    await png(markSvg(size), size, name);
  }

  // A /favicon.ico as well, for the browsers and crawlers that still ask for it
  // by convention rather than reading the link tags.
  await sharp(Buffer.from(markSvg(32)))
    .resize(32, 32)
    .png()
    .toFile(path.join(publicDir, 'favicon.ico'));

  await writeFile(
    path.join(publicDir, 'site.webmanifest'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  await writeFile(path.join(publicDir, 'robots.txt'), robotsTxt(), 'utf8');
  await writeFile(path.join(publicDir, 'sitemap.xml'), sitemapXml(), 'utf8');

  console.log(`Brand assets written to ${publicDir} (site URL: ${siteUrl})`);
}

await main();
