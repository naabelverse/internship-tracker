import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolves the four colours the brand assets are drawn in, from the shipped
 * theme tokens rather than from a copy of them.
 *
 * `generateBrandAssets.mjs` used to declare these as hex literals. That is how
 * `og-image.png` and every favicon came to ship `#33c9b6` — the jade primary —
 * for two redesigns after the app had stopped using it anywhere: nothing tied
 * the literals to `src/index.css`, so a palette change left them silently
 * stale. Reading the tokens is what removes the copy that can drift.
 *
 * Split into its own module because `generateBrandAssets.mjs` imports `sharp`
 * and generates on import; the drift test needs the colours, not the assets.
 *
 * The dark block is the right source: these assets are drawn on the dark canvas,
 * and dark is the theme the app boots into.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.join(here, '..', 'src', 'index.css');

/**
 * Matches a theme block. The same shape `tests/utils/contrast.ts` uses, and
 * `src/index.css` documents the constraint it relies on: every declaration in
 * these blocks is a flat `--name: value;`, because a nested rule would truncate
 * a match bounded by `[^}]*`.
 */
const BLOCK_RE = /(:root|\[data-theme='dark'\])\s*\{([^}]*)\}/g;

const CHANNELS_RE = /--([a-z0-9-]+):\s*(\d+ \d+ \d+);/g;

/**
 * Which token each drawn element takes its colour from.
 *
 * `brand` is the accent rather than `--color-primary-fill`: the mark bars, the
 * top rule and the footer line are graphical marks on a dark ground, which is
 * the accent's job, while the fill exists for solid buttons carrying white text.
 */
const SOURCE_TOKENS = {
  brand: 'color-primary',
  ink: 'color-text',
  canvas: 'color-canvas',
  muted: 'color-text-muted',
};

function toHex(channels) {
  return `#${channels
    .split(' ')
    .map((value) => Number(value).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Every `--name: r g b;` in one theme block, keyed without the `--`. */
export function readThemeChannels(theme, css = readFileSync(CSS_PATH, 'utf8')) {
  const selector = theme === 'light' ? ':root' : "[data-theme='dark']";
  const block = [...css.matchAll(BLOCK_RE)].find((match) => match[1] === selector);

  if (!block) throw new Error(`No ${theme} token block found in ${CSS_PATH}`);

  const channels = {};
  for (const [, name, value] of block[2].matchAll(CHANNELS_RE)) channels[name] = value;

  return channels;
}

/**
 * The brand colours as hex, read from the dark theme block.
 *
 * Throws on a missing token rather than falling back. A silent fallback is what
 * kept `http://localhost:5173` in the sitemap for a whole phase, and a brand
 * asset quietly drawn in a default colour would fail the same way — invisibly,
 * until someone looked at the output.
 */
export function readBrandPalette(css) {
  const channels = readThemeChannels('dark', css);

  return Object.fromEntries(
    Object.entries(SOURCE_TOKENS).map(([name, token]) => {
      const value = channels[token];

      if (!value) {
        throw new Error(
          `Cannot resolve the brand ${name} colour: --${token} is missing from the dark theme ` +
            `block in ${CSS_PATH}. The brand assets are drawn from the shipped tokens, so this ` +
            'has to be fixed rather than defaulted.',
        );
      }

      return [name, toHex(value)];
    }),
  );
}

export { SOURCE_TOKENS };
