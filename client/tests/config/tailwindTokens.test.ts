import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a build script, deliberately plain .mjs rather than part
// of either TypeScript project: it runs from npm before Vite or tsc are
// involved, and giving it a tsconfig would mean compiling it first.
import * as themeTokens from '../../scripts/themeTokens.mjs';
import tailwindConfig from '../../tailwind.config';

/**
 * Name parity between the Tailwind theme and the canonical palette.
 *
 * These are the two halves of one system and nothing has tied them together.
 * `tailwind.config.ts` names a token in a string — `rgb(var(--color-primary) /
 * <alpha-value>)` — so a token renamed or dropped in `tokens.json` leaves the
 * utility resolving to nothing. Tailwind does not fail on that: it emits the
 * declaration anyway, the browser discards it as invalid, and the element
 * renders with no background at all. A token added to the palette and never
 * given a utility fails the other way round, silently staying unreachable from
 * a class name and inviting the raw value that `noRawColour.test.ts` forbids.
 *
 * Both directions are checked here, against the config object rather than
 * against the file's text, so a token named only in a comment cannot count as
 * a reference.
 */

const readThemeValues = themeTokens.readThemeValues as (theme: string) => Record<string, string>;

/**
 * Every `--token` the Tailwind config refers to, at any depth.
 *
 * A deep walk rather than a read of `theme.extend.colors`, because the colours
 * are not all in `colors`: `--color-ring` is surfaced through `ringColor`, and
 * `--color-shadow` and the four `--atmos-*` values appear inside the `boxShadow`
 * strings. Checking only the `colors` block would report those five as
 * unreferenced and be wrong about all of them.
 */
function referencedTokens(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/--([a-z0-9-]+)/g)) found.add(match[1]);
  } else if (Array.isArray(value)) {
    for (const item of value) referencedTokens(item, found);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) referencedTokens(item, found);
  }

  return found;
}

describe('tailwind and the canonical palette agree on names', () => {
  const referenced = [...referencedTokens(tailwindConfig.theme)].sort();
  const light = readThemeValues('light');
  const dark = readThemeValues('dark');

  /* The walk has to be shown to have found something before parity means anything. */
  it('finds the tokens the config actually refers to', () => {
    expect(referenced.length).toBeGreaterThan(30);
    expect(referenced).toContain('color-primary');
    // The three that are not in `theme.extend.colors`, named so a future
    // refactor that narrows the walk back to that block fails here.
    expect(referenced).toContain('color-ring');
    expect(referenced).toContain('color-shadow');
    expect(referenced).toContain('atmos-cast');
  });

  /*
    Direction one: nothing in the config points at a token that is not there.

    This is the failure that renders an element with no background rather than
    with the wrong one, because an unresolved custom property makes the whole
    declaration invalid and the browser drops it.
  */
  it.each(['light', 'dark'] as const)('declares every token the config uses, in %s', (theme) => {
    const declared = theme === 'light' ? light : dark;
    const missing = referenced.filter((token) => declared[token] === undefined);

    if (missing.length > 0) {
      throw new Error(
        `tailwind.config.ts refers to ${missing.map((name) => `--${name}`).join(', ')}, which ` +
          `the ${theme} theme in client/src/theme/tokens.json does not declare. A utility ` +
          'built on a token that does not resolve emits an invalid declaration, which the ' +
          'browser discards silently — the element renders unstyled rather than wrong. Add the ' +
          'token to the palette or drop the key from the config.',
      );
    }

    expect(missing).toEqual([]);
  });

  /*
    Direction two: every colour in the palette is reachable from a class name.

    Scoped to `color-*` deliberately. The `--atmos-*` layer is decorative and
    mostly consumed by hand-written `@layer` CSS in `index.css` rather than by
    utilities, so requiring all of it to appear here would assert something that
    is not true and is not meant to be. Every `color-*` token, by contrast, is a
    colour a component is expected to reach through Tailwind.
  */
  it('gives every colour token a utility', () => {
    const colours = Object.keys(light).filter((token) => token.startsWith('color-'));
    const unreachable = colours.filter((token) => !referenced.includes(token));

    if (unreachable.length > 0) {
      throw new Error(
        `client/src/theme/tokens.json declares ${unreachable.map((n) => `--${n}`).join(', ')}, ` +
          'which no Tailwind key refers to, so nothing can reach it by class name. A colour ' +
          'that is in the palette but unreachable is what invites the hand-written literal ' +
          '`noRawColour.test.ts` rejects. Add a key to tailwind.config.ts, or remove the token.',
      );
    }

    expect(unreachable).toEqual([]);
  });

  /*
    The two themes have to declare the same names, or direction one above is only
    true for whichever theme happens to be checked first. A token present in
    light and missing from dark is a utility that works until the toggle.
  */
  it('declares the same token names in both themes', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });
});
