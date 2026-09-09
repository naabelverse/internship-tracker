import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a build script, deliberately plain .mjs rather than part
// of either TypeScript project: it runs from npm before Vite or tsc are
// involved, and giving it a tsconfig would mean compiling it first.
import * as brandPalette from '../../scripts/brandPalette.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readThemeTokens, type Rgb } from '../utils/contrast';

const readBrandPalette = brandPalette.readBrandPalette as (
  source?: string,
) => Record<string, string>;
const SOURCE_TOKENS = brandPalette.SOURCE_TOKENS as Record<string, string>;

const hex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;

/**
 * The drift check for the bug that shipped jade favicons and a jade OG image
 * for two redesigns after the app had stopped using jade.
 *
 * `generateBrandAssets.mjs` declared its four colours as hex literals, so
 * nothing connected them to `src/index.css` and a palette change left them
 * silently stale. The generator now derives them; this asserts the derivation
 * agrees with the tokens the app actually ships.
 *
 * The comparison is deliberately against `readThemeTokens` rather than against
 * literals restated here — literals are what caused the bug — and the two sides
 * now read genuinely different files. `readBrandPalette` derives from
 * `src/theme/tokens.json`, the canonical palette, while `readThemeTokens` reads
 * `src/index.css`, the stylesheet the browser is actually served. That is the
 * line DECISIONS draws between a consumer that derives and a gate that verifies
 * a shipped artifact, and it makes this assertion stronger than it was: until
 * the palette moved out of the stylesheet, both sides read one file and could
 * only ever agree.
 */
describe('brand asset palette', () => {
  const tokens = readThemeTokens('dark');
  const palette = readBrandPalette();

  it.each(Object.entries(SOURCE_TOKENS))('draws %s from the shipped --%s token', (name, token) => {
    const shipped = tokens[token];

    expect(shipped, `--${token} is missing from the dark theme block`).toBeDefined();
    expect(palette[name]).toBe(hex(shipped));
  });

  it('resolves every colour the generator needs', () => {
    expect(Object.keys(palette).sort()).toEqual(Object.keys(SOURCE_TOKENS).sort());
    for (const value of Object.values(palette)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  // The specific failure this exists to prevent: the app moves to a new primary
  // and the committed assets keep the old one.
  it('no longer resolves to the jade primary the redesign removed', () => {
    expect(palette.brand).not.toBe('#33c9b6');
  });

  /*
    A missing token must be loud. A silent fallback is what kept
    `http://localhost:5173` in the sitemap for a whole phase, and a brand asset
    drawn in a default colour would fail the same invisible way.

    The injected palette used to be a CSS string, because the generator parsed
    `index.css` with a regex of its own. It reads `src/theme/tokens.json` now, so
    the injection is the token file's shape instead. This is a deliberate
    rewrite, not a weakened assertion: the case still drives `readBrandPalette`
    with a palette that is missing `--color-primary`, and still requires it to
    throw naming that token rather than defaulting. Only the source format moved.
  */
  it('throws rather than defaulting when a token is absent', () => {
    const withoutPrimary = JSON.stringify({
      dark: {
        selector: "[data-theme='dark']",
        groups: [{ tokens: { 'color-text': '227 237 235' } }],
      },
    });

    expect(() => readBrandPalette(withoutPrimary)).toThrow(/--color-primary is missing/);
  });

  /*
    This is the assertion that would actually have caught the bug.

    Deriving the generator's colours stops a *literal* going stale, but it does
    nothing about the failure that really happened: the palette changed, nobody
    re-ran `npm run assets`, and the committed PNGs kept the old colour while
    the script would have produced the new one. Checking the script against the
    tokens cannot see that — both sides read the same file and always agree.

    `favicon.svg` is the one committed asset that is text, and it is written by
    the same run that writes the PNGs, so it stands in for all of them. If it
    carries a colour the palette no longer contains, the assets are stale and
    need regenerating.
  */
  it('has committed assets drawn in the current palette, not a previous one', () => {
    const svg = readFileSync(resolve(process.cwd(), 'public/favicon.svg'), 'utf8');
    const used = [...new Set(svg.match(/#[0-9a-f]{6}/g) ?? [])].sort();

    expect(used, 'run `npm run assets -w client` — the committed assets are stale').toEqual(
      [palette.brand, palette.canvas].sort(),
    );
  });
});
