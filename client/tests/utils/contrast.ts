import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type Rgb = readonly [number, number, number];

// Read off disk rather than imported: vitest runs with `css: false`, which stubs
// every stylesheet import to an empty string, `?raw` included.
const CSS_PATH = resolve(process.cwd(), 'src/index.css');

/**
 * Matches both token blocks in one pass. A literal regex rather than one built
 * from a selector string, so the escaping is checked by the parser.
 */
const BLOCK_RE = /(:root|\[data-theme='dark'\])\s*\{([^}]*)\}/g;

const CHANNELS_RE = /--([a-z0-9-]+):\s*(\d+ \d+ \d+);/g;

/**
 * The plain-number tokens, which is how the atmosphere layer stores its alphas.
 * Deliberately a second pattern rather than a looser one: `CHANNELS_RE` above
 * has to keep rejecting anything that is not three channels, or a stray token
 * would be read as a colour.
 */
const SCALAR_RE = /--([a-z0-9-]+):\s*(\d*\.?\d+);/g;

/** The token values one theme block actually ships, keyed without the `--`. */
export function readThemeTokens(theme: 'light' | 'dark'): Record<string, Rgb> {
  const css = readFileSync(CSS_PATH, 'utf8');
  const selector = theme === 'light' ? ':root' : "[data-theme='dark']";
  const block = [...css.matchAll(BLOCK_RE)].find((match) => match[1] === selector);

  if (!block) throw new Error(`No ${theme} token block found in src/index.css`);

  const tokens: Record<string, Rgb> = {};
  for (const [, name, value] of block[2].matchAll(CHANNELS_RE)) {
    const [r, g, b] = value.split(' ').map(Number);
    tokens[name] = [r, g, b];
  }

  return tokens;
}

/** The scalar token values one theme block ships, keyed without the `--`. */
export function readThemeNumbers(theme: 'light' | 'dark'): Record<string, number> {
  const css = readFileSync(CSS_PATH, 'utf8');
  const selector = theme === 'light' ? ':root' : "[data-theme='dark']";
  const block = [...css.matchAll(BLOCK_RE)].find((match) => match[1] === selector);

  if (!block) throw new Error(`No ${theme} token block found in src/index.css`);

  const values: Record<string, number> = {};
  for (const [, name, value] of block[2].matchAll(SCALAR_RE)) {
    values[name] = Number(value);
  }

  return values;
}

/** One 0-255 sRGB channel decoded to linear light, 0 to 1. */
export function linearChannel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance. */
function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const a = luminance(foreground);
  const b = luminance(background);

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Flattens a translucent colour onto an opaque one, which is what the browser
 * paints. The status pills are `bg-<token>/15 text-<token>`, so their real
 * background is the token at 15 percent over the card surface — not the surface.
 */
export function composite(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return [
    Math.round(foreground[0] * alpha + background[0] * (1 - alpha)),
    Math.round(foreground[1] * alpha + background[1] * (1 - alpha)),
    Math.round(foreground[2] * alpha + background[2] * (1 - alpha)),
  ];
}
