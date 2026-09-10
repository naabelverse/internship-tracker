import { describe, expect, it } from 'vitest';
import {
  composite,
  contrastRatio,
  readThemeNumbers,
  readThemeTokens,
  type Rgb,
} from '../utils/contrast';
import { SERIES_TOKENS } from '@/features/dashboard/charts/chartTokens';

/** SPEC section 6 asks for 4.5:1, which is WCAG AA for body text. */
const AA_TEXT = 4.5;
/** WCAG AA for a graphical object such as a chart series or an icon. */
const AA_NON_TEXT = 3;

/** The surfaces a foreground token is actually painted on. */
const SURFACES = ['canvas', 'surface', 'surface-muted'] as const;

const BODY_TOKENS = ['text', 'text-muted', 'text-subtle'] as const;

/** Semantics used as text on a card, e.g. the funnel labels and deadline chips. */
const SEMANTIC_TOKENS = ['primary', 'success', 'warning', 'danger', 'info'] as const;

/** `bg-<token>/15 text-<token>`, the shape every status pill and badge uses. */
const PILL_ALPHA = 0.15;

const CHART_TOKENS = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
  'chart-7',
  'chart-8',
] as const;

describe.each(['light', 'dark'] as const)('%s theme token contrast', (theme) => {
  const tokens = readThemeTokens(theme);
  const token = (name: string): Rgb => {
    const value = tokens[`color-${name}`];
    if (!value) throw new Error(`Missing token --color-${name} in the ${theme} block`);
    return value;
  };

  it.each(BODY_TOKENS.flatMap((fg) => SURFACES.map((bg) => [fg, bg] as const)))(
    '%s on %s clears AA for text',
    (fg, bg) => {
      expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  // `wash` is the one saturated ground in the palette: the auth split screen and
  // the marketing hero. It is deliberately not in SURFACES, and that difference
  // is the whole reason the canvas is pale rather than the reference's #a6c4e8.
  //
  // A ground that saturated cannot carry a status pill. `bg-<token>/15` over it
  // lands so close to the token that clearing 4.5:1 forces every semantic to
  // near-black - measured at ~1.9:1 from body text, which stops Offer-green and
  // Rejected-red reading as colour at all. So the wash carries body copy only,
  // and that is what is gated here. The exclusion is structural rather than an
  // exemption: the two call sites, AuthSplitLayout and Hero, render no pill.
  it.each(BODY_TOKENS)('%s clears AA for text on the wash', (fg) => {
    expect(contrastRatio(token(fg), token('wash'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(SEMANTIC_TOKENS)('%s clears AA as text on a card', (name) => {
    expect(contrastRatio(token(name), token('surface'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // The failure this catches is subtle and was real: a token can pass against
  // the plain surface and still fail inside its own tinted pill, because the
  // tint lifts the background towards the text colour.
  // Compositing only over `surface` checked the most forgiving of the three
  // grounds. A pill is not always on a card: the board's column-count badge is
  // painted on `surface-muted`, and that is where a 4.48 badge shipped and axe
  // caught it in a real browser. Every surface a tint is actually painted on is
  // checked now, which is what makes this a gate rather than a spot check.
  it.each(SEMANTIC_TOKENS.flatMap((fg) => SURFACES.map((bg) => [fg, bg] as const)))(
    '%s clears AA against its own 15 percent tint on %s',
    (name, surface) => {
      const tint = composite(token(name), token(surface), PILL_ALPHA);

      expect(contrastRatio(token(name), tint)).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  // The solid-fill pair is gated separately from the accent. Splitting them is
  // what lets the dark theme carry a genuinely deep button instead of a pastel
  // one, and an ungated second token would just drift back towards the accent.
  it('keeps the filled primary button readable and visible', () => {
    expect(contrastRatio(token('primary-fill-fg'), token('primary-fill'))).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    expect(
      contrastRatio(token('primary-fill-hover'), token('primary-fill-fg')),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // A deep fill on a near-black canvas can pass its own label check and still
  // be an invisible slab. The button's shape has to clear AA for a graphical
  // object against every ground it is painted on.
  it.each(SURFACES)('primary-fill reads as a shape on %s', (bg) => {
    expect(contrastRatio(token('primary-fill'), token(bg))).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it('keeps button labels readable on their filled backgrounds', () => {
    // The primary button's own pair is checked above, against the fill tokens
    // that replaced `primary-fg`. The danger button used to hardcode white,
    // which is unreadable on the dark theme's lighter red. It has its own
    // foreground token now, checked here.
    expect(contrastRatio(token('danger-fg'), token('danger'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  /*
    The hover state is a second filled background carrying the same label, so it
    needs its own measurement rather than an assumption that darkening a fill
    can only help. In the dark theme it cannot be assumed at all: `danger` there
    is a light red carrying near-black text, so the step that deepens the light
    theme's fill moves the dark theme's *toward* its own foreground.

    Measured at the values this ships: 9.88:1 in light, 6.08:1 in dark.
  */
  it('keeps the danger button readable while hovered', () => {
    expect(contrastRatio(token('danger-fg'), token('danger-hover'))).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  /* And it has to stay visible as a shape on the page while hovered. */
  it.each(SURFACES)('danger-hover reads as a shape on %s', (bg) => {
    expect(contrastRatio(token('danger-hover'), token(bg))).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it.each(CHART_TOKENS)('%s is distinguishable from the card it sits on', (name) => {
    expect(contrastRatio(token(name), token('surface'))).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  // The bug this catches shipped and reached the dashboard: `SERIES_TOKENS`
  // ended with `color-info` and `color-success`, which are byte-identical to
  // `color-chart-2` and `color-chart-4`, so the seven-category "By source"
  // chart painted two categories the same blue. Every assertion above checks a
  // token against a *background*; nothing compared the series entries with each
  // other, and that is precisely the gap that let it through.
  //
  // The list is imported rather than restated, so a ninth entry is covered the
  // day it is added and a local copy cannot drift from the one the app ships.
  it('paints every categorical series entry a different colour', () => {
    const seen = new Map<string, string>();

    for (const name of SERIES_TOKENS) {
      const key = token(name.replace(/^color-/, '')).join(' ');
      const clash = seen.get(key);

      expect(clash, `${name} duplicates ${clash ?? ''} - both are rgb(${key})`).toBeUndefined();
      seen.set(key, name);
    }

    expect(seen.size).toBe(SERIES_TOKENS.length);
  });

  it('separates the ends of the heatmap scale', () => {
    expect(contrastRatio(token('heat-4'), token('heat-0'))).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

/*
 * The atmosphere layer is decorative, but two of its layers are painted *under*
 * text, so "decorative" is not on its own an argument that they are safe.
 *
 * The hero light source lifts the canvas towards violet, which in the dark theme
 * moves every body token the wrong way. The panel glaze does the same to the
 * surface. Both are opaque at every stop by construction — nothing in this layer
 * uses `backdrop-filter`, so the value behind the text is knowable — and this is
 * where that value gets checked, at each layer's peak alpha rather than at some
 * average across the gradient.
 *
 * The vertical grade is checked too, even though it darkens in both themes and
 * so can only help today. That assertion exists to catch the inversion: an
 * `--atmos-deep` edited towards white would wash out the dark theme's text and
 * nothing else here would notice.
 */
describe.each(['light', 'dark'] as const)('%s theme atmosphere', (theme) => {
  const tokens = readThemeTokens(theme);
  const alphas = readThemeNumbers(theme);

  const rgb = (name: string): Rgb => {
    const value = tokens[name];
    if (!value) throw new Error(`Missing token --${name} in the ${theme} block`);
    return value;
  };

  const alpha = (name: string): number => {
    const value = alphas[name];
    if (value === undefined) throw new Error(`Missing token --${name} in the ${theme} block`);
    return value;
  };

  const token = (name: string): Rgb => rgb(`color-${name}`);

  /** The canvas as it is actually painted at the brightest point of the lamp. */
  const lit = composite(rgb('atmos-light'), token('canvas'), alpha('atmos-light-peak'));

  /** The canvas at the far end of the vertical grade. */
  const graded = composite(rgb('atmos-deep'), token('canvas'), alpha('atmos-deep-peak'));

  /** The panel surface under the top of its glaze, where the glaze is strongest. */
  const glazed = composite(rgb('atmos-glaze'), token('surface'), alpha('atmos-glaze-peak'));

  /*
   * There is deliberately no lamp-over-wash composite here. The wash is a flat
   * ground on the auth split screen, and no atmosphere layer is painted on it.
   *
   * The hero was the one candidate. Measured, it does not work in dark mode: the
   * lamp at 0.2 over a wash blue enough to read apart from the canvas lifts the
   * ground to rgb(36 60 102), where `text-subtle` lands at 3.83:1. Clearing 4.5
   * there needs `text-subtle` lighter than `text-muted` - inverting the
   * hierarchy - or lightening all dark secondary text on every screen to suit
   * one decorative section. So the hero keeps its canvas-based atmosphere and
   * the wash stays flat.
   */
  it.each(BODY_TOKENS)('%s clears AA at the peak of the hero light source', (fg) => {
    expect(contrastRatio(token(fg), lit)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(BODY_TOKENS)('%s clears AA at the far end of the vertical grade', (fg) => {
    expect(contrastRatio(token(fg), graded)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(BODY_TOKENS)('%s clears AA under the panel glaze', (fg) => {
    expect(contrastRatio(token(fg), glazed)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // The panel carries status text, not just body copy: the hero's "in 2 days" is
  // `text-warning` sitting directly on the glazed surface.
  it.each(SEMANTIC_TOKENS)('%s clears AA as text on the glazed panel', (name) => {
    expect(contrastRatio(token(name), glazed)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
