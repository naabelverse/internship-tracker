import { describe, expect, it } from 'vitest';
// @ts-expect-error -- build scripts, deliberately plain .mjs rather than part of
// either TypeScript project: they run from npm before Vite or tsc are involved,
// and giving them a tsconfig would mean compiling them first.
import * as generator from '../../scripts/generateThemeCss.mjs';
// @ts-expect-error -- same boundary as above.
import * as themeTokens from '../../scripts/themeTokens.mjs';
import { readRepoFile } from './repoFile';
import { readThemeTokens, type Rgb } from '../utils/contrast';

/**
 * The gate that makes `src/theme/tokens.json` the source of truth by
 * construction rather than by convention.
 *
 * Three fixes had already shipped for one class of bug — jade favicons (#7), a
 * localhost sitemap, an indigo email palette (#10) — each of them after a stale
 * hand-copied value had already reached a real consumer. Every one was
 * retrospective, and each left the same arrangement in place: the values lived
 * only in `index.css`, so anything needing a colour had to copy it or parse it.
 * The palette now lives in JSON and the stylesheet is written from it. This
 * fails if the two disagree.
 *
 * The comparison is deliberately made against the *committed* stylesheet rather
 * than against the token file the generator just read. DECISIONS records why:
 * asserting a generator's output equals its own input cannot fail, because both
 * sides read one file and always agree. What can fail — and is the failure that
 * actually happened three times — is a committed artifact left behind after the
 * palette moved.
 */
const renderStylesheet = generator.renderStylesheet as (css?: string, source?: string) => string;
const renderBlock = generator.renderBlock as (theme: string, source?: string) => string;
const readThemeValues = themeTokens.readThemeValues as (
  theme: string,
  source?: string,
) => Record<string, string>;
const readThemeChannels = themeTokens.readThemeChannels as (
  theme: string,
  source?: string,
) => Record<string, string>;
const readTheme = themeTokens.readTheme as (theme: string, source?: string) => unknown;

const STYLESHEET = 'client/src/index.css';

const hex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;

const channelsToHex = (channels: string): string => {
  const [r, g, b] = channels.split(' ').map(Number);
  return hex([r, g, b] as Rgb);
};

describe('theme token generation', () => {
  const css = readRepoFile(STYLESHEET);

  /*
    The assertion the whole restructure rests on.

    If someone edits a colour in `index.css` by hand, this fails and names the
    command that fixes it — which is what makes the stylesheet an output rather
    than a place to type a value into. If someone edits `tokens.json` and does
    not regenerate, it fails the same way.
  */
  it('has a committed stylesheet matching the canonical palette', () => {
    const generated = renderStylesheet(css);

    if (generated !== css) {
      throw new Error(
        `${STYLESHEET} does not match src/theme/tokens.json. The theme blocks are generated ` +
          'from the token file, so either the palette changed and the stylesheet was not ' +
          'regenerated, or a colour was edited directly in the CSS. Run ' +
          '`npm run generate:theme -w client` and commit the result.',
      );
    }

    expect(generated).toBe(css);
  });

  it('is idempotent, so a second run is always a no-op', () => {
    expect(renderStylesheet(renderStylesheet(css))).toBe(renderStylesheet(css));
  });

  /*
    Proves the generator genuinely rebuilds the block rather than matching
    nothing and handing the input back. Without this, a regex that silently
    stopped matching would make the assertion above pass forever — which is the
    shape of the worthless drift check DECISIONS already records having written
    once.
  */
  it.each([
    ['light', '--color-primary: 1 2 3;'],
    ['dark', '--color-primary: 4 5 6;'],
  ])('rebuilds the %s block from the token file', (_theme, expected) => {
    const source = JSON.stringify({
      light: { selector: ':root', groups: [{ tokens: { 'color-primary': '1 2 3' } }] },
      dark: {
        selector: "[data-theme='dark']",
        groups: [{ tokens: { 'color-primary': '4 5 6' } }],
      },
    });

    const output = renderStylesheet(css, source);

    expect(output).not.toBe(css);
    expect(output).toContain(expected);
  });

  /*
    A second, independently written reader is what checks the first.

    `readThemeTokens` is the contrast suite's own CSS parser, exercised by every
    assertion in `tokenContrast.test.ts`. Comparing the token file against what
    that reader sees in the shipped stylesheet ties the canonical source to the
    bytes the browser is actually served, through code that was not written for
    this test.
  */
  it.each(['light', 'dark'] as const)(
    'ships every %s colour the token file declares, as the CSS parser sees it',
    (theme) => {
      const declared = readThemeChannels(theme);
      const shipped = readThemeTokens(theme);

      expect(Object.keys(declared).length).toBeGreaterThan(0);

      for (const [name, channels] of Object.entries(declared)) {
        const value = shipped[name];

        expect(
          value,
          `--${name} is missing from the ${theme} block of ${STYLESHEET}`,
        ).toBeDefined();
        expect(hex(value)).toBe(channelsToHex(channels));
      }
    },
  );

  /*
    The atmosphere layer stores bare alphas and a keyword in the same block as
    the colours. A consumer asking for a colour must never be handed one of
    those, which is the contract the old regex reader had and this one keeps.
  */
  it('separates colour tokens from the scalars and keywords beside them', () => {
    const values = readThemeValues('light');
    const channels = readThemeChannels('light');

    expect(values['atmos-grade-axis']).toBe('to bottom');
    expect(values['atmos-light-peak']).toBe('1');
    expect(channels['atmos-grade-axis']).toBeUndefined();
    expect(channels['atmos-light-peak']).toBeUndefined();
    expect(channels['color-primary']).toBe(values['color-primary']);
  });

  // A malformed source must be loud. A silent fallback is what kept
  // `http://localhost:5173` in the sitemap for a whole phase.
  it('throws rather than defaulting when a theme is absent', () => {
    expect(() => readTheme('light', JSON.stringify({}))).toThrow(/No "light" theme/);
  });

  it('throws when the token file and the stylesheet disagree on the selector', () => {
    const source = JSON.stringify({
      light: { selector: '.light', groups: [] },
      dark: { selector: "[data-theme='dark']", groups: [] },
    });

    expect(() => renderBlock('light', source)).toThrow(/declares selector \.light/);
  });
});
