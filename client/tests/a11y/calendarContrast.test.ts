import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, readThemeTokens, type Rgb } from '../utils/contrast';

/** WCAG AA for body text. */
const AA_TEXT = 4.5;
/** WCAG AA for a graphical object, here the selection ring and the today dot. */
const AA_NON_TEXT = 3;

/**
 * The date picker's days (`.date-calendar` in `index.css`). Like the dropdown
 * rows, hovered and selected are `primary` tints over the card's `surface`,
 * and the accent flips between near-black and near-white across themes, so
 * each theme is measured on its own. The alphas are read from the stylesheet,
 * so a tint edited there is what gets measured.
 *
 * On top of the text, two marks are gated as non-text contrast: the selected
 * day's hairline ring, against the card around it, and today's dot, on a
 * plain, hovered and selected day, since today can be any of the three.
 */
describe.each(['light', 'dark'] as const)('%s theme calendar days', (theme) => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
  const tokens = readThemeTokens(theme);
  const token = (name: string): Rgb => {
    const value = tokens[`color-${name}`];
    if (!value) throw new Error(`Missing token --color-${name} in the ${theme} block`);
    return value;
  };

  /** The `bg-primary/<n>` alpha a `.date-calendar` day rule applies. */
  const tintAlpha = (selector: string): number => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const percent = new RegExp(`${escaped}\\s*\\{[^}]*bg-primary/(\\d+)`).exec(css)?.[1];
    if (!percent) throw new Error(`${selector} no longer tints with bg-primary`);
    return Number(percent) / 100;
  };

  const hoverAlpha = tintAlpha('.date-calendar .rdp-day_button:hover');
  const selectedAlpha = tintAlpha('.date-calendar .rdp-selected .rdp-day_button');

  const days = {
    plain: token('surface'),
    hovered: composite(token('primary'), token('surface'), hoverAlpha),
    selected: composite(token('primary'), token('surface'), selectedAlpha),
  };

  it.each(Object.keys(days) as (keyof typeof days)[])(
    'keeps a %s day’s numeral readable',
    (day) => {
      expect(contrastRatio(token('text'), days[day])).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  it('keeps days outside the month readable, hovered or not', () => {
    expect(contrastRatio(token('text-subtle'), days.plain)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(token('text-subtle'), days.hovered)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('draws the selection ring visibly against the card', () => {
    expect(contrastRatio(token('primary'), token('surface'))).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it.each(Object.keys(days) as (keyof typeof days)[])('shows today’s dot on a %s day', (day) => {
    expect(contrastRatio(token('primary'), days[day])).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it('tints the selected day more strongly than a hovered one', () => {
    expect(selectedAlpha).toBeGreaterThan(hoverAlpha);
  });
});
