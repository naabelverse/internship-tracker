import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEME_SELECTORS, readTheme } from './themeTokens.mjs';

/**
 * Writes the two theme blocks in `src/index.css` from `src/theme/tokens.json`.
 *
 * This is the structural inversion the three earlier drift fixes each worked
 * around rather than closed. `index.css` used to be the source of truth by
 * convention: the values lived only in the stylesheet, so anything else that
 * needed one either parsed CSS or — three times now — carried a hand-copied hex
 * that went stale the next time the palette moved. The stylesheet is now an
 * output, and the values have a home a script can read directly.
 *
 * Only the two token blocks are rewritten. Everything else in `index.css` — the
 * `@layer base`, `@layer components` and `@layer utilities` rules, which are
 * the majority of the file and are not derivable from a palette — is
 * hand-written and left exactly as it is. Generating the whole file would mean
 * moving that CSS into a template here, which is strictly worse.
 *
 * The blocks are located by their selector rather than by inserted marker
 * comments. That is the anchor `brandPalette.mjs`, `tests/utils/contrast.ts`,
 * `tests/utils/themeTokens.ts` and `server/tests/mail.palette.test.ts` already
 * match on, and `index.css`'s own header documents the flat-declaration
 * constraint that makes it correct — so this adds no new syntax for a later
 * edit to break, and lets the first run be provably a no-op.
 *
 * Run with `npm run generate:theme -w client`.
 * `tests/config/themeTokens.test.ts` fails if the committed CSS falls behind.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.join(here, '..', 'src', 'index.css');

/**
 * One theme's declarations, formatted exactly as the stylesheet holds them.
 *
 * Comments are emitted verbatim, as the raw lines they are in the source file,
 * rather than re-wrapped from prose. The blocks carry both a single-line form
 * and a multi-line one, and inferring which to use would be a second thing that
 * could drift; storing the lines as written cannot.
 */
export function renderBlock(theme, source) {
  const { selector, groups } = readTheme(theme, source);

  const body = groups
    .map((group) => {
      const comment = group.comment ?? [];
      const declarations = Object.entries(group.tokens).map(
        ([name, value]) => `  --${name}: ${value};`,
      );

      return [...comment, ...declarations].join('\n');
    })
    .join('\n\n');

  return `${selector} {\n${body}\n}`;
}

/** Matches a whole theme block, the same shape every reader of this file uses. */
function blockPattern(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return new RegExp(`${escaped}\\s*\\{[^}]*\\}`);
}

/**
 * The stylesheet with both blocks rewritten from the canonical palette.
 *
 * Split from the file write so the drift test can ask "what would this produce"
 * without touching the working tree.
 */
export function renderStylesheet(css = readFileSync(CSS_PATH, 'utf8'), source) {
  let output = css;

  for (const [theme, selector] of Object.entries(THEME_SELECTORS)) {
    const pattern = blockPattern(selector);

    if (!pattern.test(output)) {
      throw new Error(
        `No ${selector} block found in ${CSS_PATH}. The theme blocks are generated from ` +
          'src/theme/tokens.json and located by their selector, so a renamed or reformatted ' +
          'block has to be fixed rather than silently skipped.',
      );
    }

    // A function replacement, so a `$&` or `$1` occurring in a token value is
    // inserted literally rather than read as a backreference.
    output = output.replace(pattern, () => renderBlock(theme, source));
  }

  return output;
}

export { CSS_PATH };

// Only write when run directly; the drift test imports the renderers above.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const current = readFileSync(CSS_PATH, 'utf8');
  const next = renderStylesheet(current);

  writeFileSync(CSS_PATH, next, 'utf8');

  console.log(
    next === current
      ? `${CSS_PATH} is already up to date with src/theme/tokens.json`
      : `Theme blocks in ${CSS_PATH} rewritten from src/theme/tokens.json`,
  );
}
