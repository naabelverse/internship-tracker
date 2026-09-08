import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { MARK_BOX, MARK_BOX_TIGHT, MARK_PATH, TILE_RADIUS } from './brandMark.mjs';
import { readBrandPalette } from './brandPalette.mjs';

/**
 * Generates the static brand and SEO assets SPEC section 12 asks for: an
 * `og-image.png`, favicons at the standard sizes and a web manifest.
 *
 * They are generated rather than hand-drawn so the wordmark and the colours come
 * from one definition; they are then **committed**, because a favicon that
 * exists only after someone remembers to run a script is a favicon that goes
 * missing. Re-run with `npm run assets -w client` after changing the palette.
 *
 * `robots.txt` and `sitemap.xml` used to be written here too, and that was a
 * bug: they embed the deployment origin, so a committed copy shipped
 * `http://localhost:5173` to production. They belong to
 * `generateSeoFiles.mjs`, which runs on every build.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

/*
  The "Dispatch" palette, read from the dark theme block of `src/index.css`
  rather than copied here. These were four hex literals, which is how every
  favicon and the OG image came to ship the jade primary for two redesigns after
  the app stopped using it: nothing tied the copies to the tokens. Re-run
  `npm run assets -w client` after changing the palette, and
  `tests/config/brandPalette.test.ts` fails if the assets fall behind it.
*/
const { brand: BRAND, ink: INK, canvas: CANVAS, muted: MUTED } = readBrandPalette();
const SITE_NAME = 'Internship Tracker';

/**
 * The square app icon: the mark on the canvas, in a rounded tile.
 *
 * The shape is `MARK_PATH` rather than a copy of it restated here, so the icon
 * and the `BrandMark` the app renders cannot drift apart - that drift is what
 * this file's colours already had to be rescued from. The tile takes the padded
 * box: an icon needs air between the glyph and its corners in a way an inline
 * mark set against type does not.
 */
function markSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${MARK_BOX}">
  <rect width="512" height="512" rx="${TILE_RADIUS}" fill="${CANVAS}"/>
  <path fill="${BRAND}" d="${MARK_PATH}"/>
</svg>`;
}

function ogImageSvg() {
  const font = 'Helvetica,Arial,sans-serif';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${CANVAS}"/>
  <rect x="0" y="0" width="1200" height="8" fill="${BRAND}"/>

  <svg x="80" y="130" width="64" height="64" viewBox="${MARK_BOX_TIGHT}"><path fill="${BRAND}" d="${MARK_PATH}"/></svg>
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

  console.log(`Brand assets written to ${publicDir}`);
}

await main();
