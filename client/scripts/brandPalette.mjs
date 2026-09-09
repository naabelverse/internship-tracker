import { TOKENS_PATH, readThemeChannels, toHex } from './themeTokens.mjs';

/**
 * Resolves the four colours the brand assets are drawn in, from the canonical
 * palette rather than from a copy of them.
 *
 * `generateBrandAssets.mjs` used to declare these as hex literals. That is how
 * `og-image.png` and every favicon came to ship `#33c9b6` — the jade primary —
 * for two redesigns after the app had stopped using it anywhere: nothing tied
 * the literals to the palette, so a colour change left them silently stale.
 * Deriving them is what removes the copy that can drift.
 *
 * This used to parse `src/index.css` with a regex of its own, because the
 * stylesheet was the only place the values existed. It is not any more:
 * `src/theme/tokens.json` is the source and the stylesheet is generated from it,
 * so the values are readable as data and this module no longer needs a parser.
 * `themeTokens.mjs` is the one reader; what is left here is the mapping from a
 * drawn element to the token it takes its colour from, which is this module's
 * actual subject.
 *
 * Reading the token file rather than the generated stylesheet is the right side
 * of the line DECISIONS draws: a consumer that *derives* a value reads the
 * canonical source, while a gate that *verifies a shipped artifact* keeps
 * reading the artifact. This derives, so it reads the source.
 *
 * Split into its own module because `generateBrandAssets.mjs` imports `sharp`
 * and generates on import; the drift test needs the colours, not the assets.
 *
 * The dark theme is the right source: these assets are drawn on the dark canvas,
 * and dark is the theme the app boots into.
 */

/**
 * Which token each drawn element takes its colour from.
 *
 * `brand` is the accent rather than `--color-primary-fill`: the mark, the top
 * rule and the footer line are graphical marks on a dark ground, which is the
 * accent's job, while the fill exists for solid buttons carrying white text.
 */
const SOURCE_TOKENS = {
  brand: 'color-primary',
  ink: 'color-text',
  canvas: 'color-canvas',
  muted: 'color-text-muted',
};

/**
 * The brand colours as hex, read from the dark theme.
 *
 * `source` is the JSON text of the token file, injectable so a test can exercise
 * a malformed palette without writing one to disk. It was a CSS string until the
 * palette moved into `tokens.json`; the format changed, the contract did not.
 *
 * Throws on a missing token rather than falling back. A silent fallback is what
 * kept `http://localhost:5173` in the sitemap for a whole phase, and a brand
 * asset quietly drawn in a default colour would fail the same way — invisibly,
 * until someone looked at the output.
 */
export function readBrandPalette(source) {
  const channels = readThemeChannels('dark', source);

  return Object.fromEntries(
    Object.entries(SOURCE_TOKENS).map(([name, token]) => {
      const value = channels[token];

      if (!value) {
        throw new Error(
          `Cannot resolve the brand ${name} colour: --${token} is missing from the dark theme ` +
            `in ${TOKENS_PATH}. The brand assets are drawn from the canonical palette, so this ` +
            'has to be fixed rather than defaulted.',
        );
      }

      return [name, toHex(value)];
    }),
  );
}

export { SOURCE_TOKENS };
