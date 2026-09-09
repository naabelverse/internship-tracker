import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
// @ts-expect-error -- a build script, deliberately plain .mjs rather than part
// of either TypeScript project: it runs from npm before Vite or tsc are
// involved, and giving it a tsconfig would mean compiling it first.
import * as themeTokens from '../../scripts/themeTokens.mjs';
import { resolveRepoDir } from './repoFile';

/**
 * Finds colour values written by hand anywhere in the two `src` trees.
 *
 * Four fixes have now been made for one class of bug — jade favicons (#7), a
 * localhost sitemap, an indigo email palette (#10), and the palette's move out
 * of the stylesheet. Every one of them was about a colour that existed in two
 * places at once. The gates that came out of those fixes each guard one known
 * consumer; none of them notices a *new* hand-copied value appearing somewhere
 * nobody has thought to write a gate for. This is the general case.
 *
 * The rule it enforces: a colour in `src` comes from a token, so the only
 * literal colour values are the ones in the canonical palette and in the files
 * generated from it.
 */

const THEME_SELECTORS = themeTokens.THEME_SELECTORS as Record<string, string>;

/** Where a raw colour was found. `line` is 1-indexed, into the original file. */
export interface RawColour {
  file: string;
  literal: string;
  line: number;
}

/**
 * A hex colour: 3, 4, 6 or 8 digits, the four lengths CSS actually defines.
 *
 * Bounded on both sides so a CSS id selector cannot match. Longest alternative
 * first, so `#682eb3ff` is read as one eight-digit colour rather than a
 * six-digit one with two characters left over.
 */
const HEX = /(?<!\w)#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;

/**
 * A string literal whose entire content is three integers.
 *
 * This is deliberately narrow. `tokens.json` stores every colour as three
 * space-separated channels, so that is the exact shape a hand-copied token
 * takes — and requiring the literal to hold nothing else is what keeps SVG path
 * data out of the results. `viewBox="0 0 24 24"` and `d="M12 2a2 2 0 009..."`
 * are full of three-number runs; neither is a string that is only three numbers.
 */
const QUOTED_TRIPLET = /(['"`])\s*(\d{1,3}) (\d{1,3}) (\d{1,3})\s*\1/g;

/** The same value in CSS, where it appears as a custom property declaration. */
const CSS_TRIPLET = /--[a-z0-9-]+:\s*(\d{1,3}) (\d{1,3}) (\d{1,3})\s*;/g;

/** Channels run 0-255; anything larger is a coordinate, not a colour. */
const inRange = (...parts: string[]): boolean => parts.every((part) => Number(part) <= 255);

/**
 * The source with comments blanked out, character for character.
 *
 * A character walk rather than a regex, because a regex for `//` eats the tail
 * of every line containing a `https://` URL, and would quietly hide a colour
 * sitting after one. String state is tracked for the same reason in reverse: a
 * `/*` inside a string literal does not open a comment.
 *
 * Every replacement is the same length as what it replaced, and newlines are
 * kept, so a match index in the result still maps to its line in the original.
 *
 * Comments are excluded because a colour named in prose is documentation, not a
 * value the app can paint with. `server/src/mail/layout.ts` documents the
 * `#4f46e5` that issue #10 was about, and that has to stay readable — while a
 * real hex added to that same file still has to fail.
 */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;

  while (i < source.length) {
    const current = source[i];
    const next = source[i + 1];

    if (quote !== null) {
      if (current === '\\') {
        out += '  ';
        i += 2;
        continue;
      }
      if (current === quote) quote = null;
      out += current;
      i += 1;
      continue;
    }

    if (current === "'" || current === '"' || current === '`') {
      quote = current;
      out += current;
      i += 1;
      continue;
    }

    if (current === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }

    if (current === '/' && next === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
      continue;
    }

    out += current;
    i += 1;
  }

  return out;
}

/** Blanks a span, keeping its length and its newlines so offsets still line up. */
const blank = (text: string): string => text.replace(/[^\n]/g, ' ');

/**
 * `index.css` with its two generated theme blocks blanked out.
 *
 * The stylesheet is not skipped wholesale, and that is the point. Only the two
 * blocks are written from `tokens.json`; roughly 62% of the file is hand-written
 * `@layer` CSS that no palette can produce, and that is exactly where someone
 * would type a colour by hand. Excluding the file would leave the majority of it
 * unguarded.
 *
 * Located by selector, the anchor every other reader of this file already uses.
 */
export function stripGeneratedThemeBlocks(css: string): string {
  let out = css;

  for (const selector of Object.values(THEME_SELECTORS)) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escaped}\\s*\\{[^}]*\\}`);

    if (!pattern.test(out)) {
      throw new Error(
        `No ${selector} block found in client/src/index.css. The generated blocks are located ` +
          'by their selector, so a renamed or reformatted block has to be fixed rather than ' +
          'silently left in the scan.',
      );
    }

    out = out.replace(pattern, blank);
  }

  return out;
}

/** The file extensions worth reading. The two `src` trees hold nothing else. */
const SCANNED = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.json']);

/**
 * The canonical palette, and the files generated from it.
 *
 * These are the only places a colour value is allowed to exist in full, because
 * they are the definition and its outputs rather than copies of it.
 */
export const GENERATED = new Set(['client/src/theme/tokens.json', 'server/src/mail/palette.ts']);

/** Every scanned file under a tree, repo-relative and slash-separated. */
function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);

    if (statSync(full).isDirectory()) walk(full, found);
    else if (SCANNED.has(path.extname(entry))) found.push(full);
  }

  return found;
}

const lineOf = (source: string, index: number): number => source.slice(0, index).split('\n').length;

/** The two trees a colour could be painted from. */
const TREES = ['client/src', 'server/src'];

/**
 * Every hand-written colour in both `src` trees, in file order.
 *
 * Returns the files it read alongside the findings rather than asserting, so
 * the test can check the walk itself. A scan that silently reached nothing —
 * a renamed directory, a `resolveRepoDir` that landed one level too high —
 * would otherwise report a clean tree forever.
 */
export function findRawColours(): { findings: RawColour[]; files: string[] } {
  const findings: RawColour[] = [];
  const files: string[] = [];

  for (const tree of TREES) {
    const dir = resolveRepoDir(tree);

    for (const absolute of walk(dir)) {
      const file = `${tree}/${path.relative(dir, absolute).split(path.sep).join('/')}`;

      if (GENERATED.has(file)) continue;
      files.push(file);

      let source = readFileSync(absolute, 'utf8');
      if (file === 'client/src/index.css') source = stripGeneratedThemeBlocks(source);

      const stripped = stripComments(source);

      for (const match of stripped.matchAll(HEX)) {
        findings.push({ file, literal: match[0], line: lineOf(stripped, match.index) });
      }

      for (const match of stripped.matchAll(QUOTED_TRIPLET)) {
        if (!inRange(match[2], match[3], match[4])) continue;
        findings.push({
          file,
          literal: `${match[2]} ${match[3]} ${match[4]}`,
          line: lineOf(stripped, match.index),
        });
      }

      for (const match of stripped.matchAll(CSS_TRIPLET)) {
        if (!inRange(match[1], match[2], match[3])) continue;
        findings.push({
          file,
          literal: `${match[1]} ${match[2]} ${match[3]}`,
          line: lineOf(stripped, match.index),
        });
      }
    }
  }

  return { findings, files };
}
