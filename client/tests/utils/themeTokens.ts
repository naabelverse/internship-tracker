import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read off disk rather than imported: vitest runs with `css: false`, which
// stubs every stylesheet import to an empty string, `?raw` included. The path is
// resolved from the vitest root, which is this workspace.
const CSS_PATH = resolve(process.cwd(), 'src/index.css');

/**
 * Installs the app's real token blocks into the test document.
 *
 * Vitest runs with `css: false`, so no stylesheet reaches jsdom and every custom
 * property would resolve to an empty string. Rather than restating the palette
 * here — which would let a chart test pass against values the app no longer
 * ships — the `:root` and `[data-theme='dark']` blocks are read straight out of
 * `src/index.css`, so the assertions are made against the shipped colours.
 */
export function installThemeTokens(): HTMLStyleElement {
  const css = readFileSync(CSS_PATH, 'utf8');
  const blocks = [...css.matchAll(/(:root|\[data-theme='dark'\])\s*\{[^}]*\}/g)].map(
    (match) => match[0],
  );

  if (blocks.length < 2) {
    throw new Error('Could not find both theme token blocks in src/index.css');
  }

  const style = document.createElement('style');
  style.dataset.testTokens = 'true';
  style.textContent = blocks.join('\n');
  document.head.append(style);

  return style;
}

/** The value a token resolves to right now, as Chart.js would receive it. */
export function tokenColor(name: string): string {
  const channels = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();

  return `rgb(${channels})`;
}

export function removeThemeTokens(): void {
  for (const style of document.head.querySelectorAll('style[data-test-tokens]')) {
    style.remove();
  }
}
