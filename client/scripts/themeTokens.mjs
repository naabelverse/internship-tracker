import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The one reader of the canonical palette.
 *
 * `src/theme/tokens.json` holds the colour values; `src/index.css` is written
 * from it by `generateThemeCss.mjs`. That inversion is the point: until now the
 * stylesheet was the source of truth by convention, and every consumer that
 * needed a colour had to parse CSS to get one. Three fixes had already shipped
 * for the same class of bug — jade favicons (#7), a localhost sitemap, an
 * indigo email palette (#10) — each of them after a stale hand-copied value had
 * already reached a real consumer. Data a script can read without a parser is
 * what stops the fourth.
 *
 * Plain `.mjs`, and JSON rather than TypeScript, for the reason
 * `brandPalette.mjs` and `brandMark.mjs` are both plain `.mjs`: these run from
 * npm before Vite or tsc exist. A `.ts` canonical source would have to be
 * compiled before the brand-asset generator could read it, which is exactly the
 * boundary that forced `BrandMark` to restate its path rather than import it.
 * `readFileSync` + `JSON.parse` works unchanged from a build script, from
 * vitest and from jest.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** The canonical source. Exported so a failure can name it. */
export const TOKENS_PATH = path.join(here, '..', 'src', 'theme', 'tokens.json');

/**
 * The selector each theme's declarations are emitted under.
 *
 * Held here rather than trusted from the JSON's own `selector` field so the
 * generator and the readers agree on the mapping without the data file being
 * able to move it on its own; `readTheme` checks the two against each other.
 */
export const THEME_SELECTORS = {
  light: ':root',
  dark: "[data-theme='dark']",
};

/**
 * The parsed token file.
 *
 * `source` is injectable so a test can exercise a malformed file without
 * writing one to disk — the same shape `readBrandPalette(css)` already had.
 */
export function readTokenFile(source = readFileSync(TOKENS_PATH, 'utf8')) {
  return JSON.parse(source);
}

/**
 * One theme: its selector and its groups, in file order.
 *
 * Order is load-bearing. The generated CSS is compared byte-for-byte against
 * the committed stylesheet, so a reordered group would read as drift. JSON
 * object keys preserve insertion order for non-numeric names, which every token
 * name here is.
 */
export function readTheme(theme, source) {
  const parsed = readTokenFile(source);
  const block = parsed[theme];

  if (!block) {
    throw new Error(
      `No "${theme}" theme in ${TOKENS_PATH}. The palette is the source the stylesheet is ` +
        'written from, so a missing theme has to be fixed there rather than defaulted here.',
    );
  }

  const expected = THEME_SELECTORS[theme];

  if (block.selector !== expected) {
    throw new Error(
      `The "${theme}" theme in ${TOKENS_PATH} declares selector ${block.selector}, but the ` +
        `stylesheet applies it as ${expected}. These have to agree: the generated block is ` +
        'located by its selector, and every reader of index.css matches on the same text.',
    );
  }

  return block;
}

/** Every token in one theme, flattened across groups, keyed without the `--`. */
export function readThemeValues(theme, source) {
  const values = {};

  for (const group of readTheme(theme, source).groups) {
    Object.assign(values, group.tokens);
  }

  return values;
}

/** Three space-separated integers — the shape every colour token holds. */
const CHANNELS = /^\d+ \d+ \d+$/;

/**
 * The colour tokens in one theme, keyed without the `--`.
 *
 * Deliberately narrower than `readThemeValues`: the atmosphere layer stores
 * bare alphas (`--atmos-light-peak: 1`) and a keyword (`--atmos-grade-axis: to
 * bottom`) in the same block, and a consumer asking for a colour must not be
 * handed one of those. This preserves the contract the regex reader in
 * `brandPalette.mjs` had, whose channel pattern rejected anything that was not
 * three integers.
 */
export function readThemeChannels(theme, source) {
  const channels = {};

  for (const [name, value] of Object.entries(readThemeValues(theme, source))) {
    if (CHANNELS.test(value)) channels[name] = value;
  }

  return channels;
}

/** `232 237 236` to `#e8edec`. The form every generated asset wants. */
export function toHex(channels) {
  return `#${channels
    .split(' ')
    .map((value) => Number(value).toString(16).padStart(2, '0'))
    .join('')}`;
}
