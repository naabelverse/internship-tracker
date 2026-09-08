import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
// @ts-expect-error -- a build script, deliberately plain .mjs rather than part
// of either TypeScript project: it runs from npm before Vite or tsc are
// involved, and giving it a tsconfig would mean compiling it first.
import * as brandMark from '../../scripts/brandMark.mjs';
import { BrandMark } from '@/components/marketing/MarketingChrome';
import { readRepoFile } from './repoFile';

const MARK_PATH = brandMark.MARK_PATH as string;
const MARK_BOX_TIGHT = brandMark.MARK_BOX_TIGHT as string;

/**
 * The shape half of the drift check `brandPalette.test.ts` runs for the colours.
 *
 * That one exists because the generator held four hex literals with nothing
 * tying them to `src/index.css`, so the favicons shipped a primary the app had
 * abandoned. The geometry had the identical problem and nobody had noticed: the
 * mark was three `<rect>`s written out three separate times — in `BrandMark`, in
 * `markSvg`, and inline in the OG image — so a redrawn mark could reach the
 * header while every icon kept the old one.
 *
 * `scripts/brandMark.mjs` is now the single definition. The generator imports
 * it; `BrandMark` cannot, because that module runs from npm before Vite or tsc
 * are involved, so it restates the path and this file is what holds the two
 * together.
 */
describe('brand mark geometry', () => {
  const svg = (): SVGSVGElement => {
    const { container } = render(<BrandMark />);
    const element = container.querySelector('svg');

    if (!element) throw new Error('BrandMark rendered no <svg>');

    return element;
  };

  it('draws the path scripts/brandMark.mjs defines', () => {
    const paths = [...svg().querySelectorAll('path')];

    expect(paths).toHaveLength(1);
    expect(paths[0]?.getAttribute('d')).toBe(MARK_PATH);
  });

  it('frames the glyph on its own bounds, so it holds its weight beside the wordmark', () => {
    expect(svg().getAttribute('viewBox')).toBe(MARK_BOX_TIGHT);
  });

  // The mark carries no colour of its own; `text-primary` on every caller is
  // what resolves `--color-primary` per theme. A fill here would be the same
  // second source of truth the palette test was written to stamp out.
  it('paints in currentColor rather than a hex of its own', () => {
    const markup = svg().outerHTML;

    expect(svg().getAttribute('fill')).toBe('currentColor');
    expect(markup).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  /*
    The assertion that would actually catch the failure this is modelled on.

    Deriving the generator's shape from one module stops the *copies* diverging,
    but not the failure that really happened to the colours: the definition
    changed, nobody re-ran `npm run assets`, and the committed files kept the old
    one. Both sides of the check above read the same module and always agree.

    `favicon.svg` is the one committed asset that is text, and the same run
    writes it and the PNGs, so it stands in for all of them.
  */
  it('has committed icons drawn from the current path, not a previous one', () => {
    const favicon = readRepoFile('client/public/favicon.svg');
    const drawn = favicon.match(/ d="([^"]+)"/g)?.map((match) => match.slice(4, -1)) ?? [];

    expect(drawn.join(' '), 'run `npm run assets -w client` — the committed icons are stale').toBe(
      MARK_PATH,
    );
  });

  // The mark has to survive a 16px favicon, and at that size a curve is a
  // smudge. Straight edges are a requirement of the shape, not an accident of
  // how it happened to be drawn.
  it('is straight-edged, so it stays crisp at favicon sizes', () => {
    expect(MARK_PATH).not.toMatch(/[CcSsQqTtAa]/);
    expect(MARK_PATH).toMatch(/^M[\d\s.HVLZ]+Z$/);
  });
});
