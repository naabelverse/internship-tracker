import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, readThemeTokens, type Rgb } from '../utils/contrast';

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

const CHART_TOKENS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'] as const;

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

  it.each(SEMANTIC_TOKENS)('%s clears AA as text on a card', (name) => {
    expect(contrastRatio(token(name), token('surface'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // The failure this catches is subtle and was real: a token can pass against
  // the plain surface and still fail inside its own tinted pill, because the
  // tint lifts the background towards the text colour.
  it.each(SEMANTIC_TOKENS)('%s clears AA against its own 15 percent tint', (name) => {
    const tint = composite(token(name), token('surface'), PILL_ALPHA);

    expect(contrastRatio(token(name), tint)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('keeps button labels readable on their filled backgrounds', () => {
    expect(contrastRatio(token('primary-fg'), token('primary'))).toBeGreaterThanOrEqual(AA_TEXT);
    // The danger button used to hardcode white, which is unreadable on the dark
    // theme's lighter red. It has its own foreground token now, checked here.
    expect(contrastRatio(token('danger-fg'), token('danger'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(CHART_TOKENS)('%s is distinguishable from the card it sits on', (name) => {
    expect(contrastRatio(token(name), token('surface'))).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it('separates the ends of the heatmap scale', () => {
    expect(contrastRatio(token('heat-4'), token('heat-0'))).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});
