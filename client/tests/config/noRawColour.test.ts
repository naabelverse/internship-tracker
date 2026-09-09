import { describe, expect, it } from 'vitest';
import { GENERATED, findRawColours, stripComments, type RawColour } from './rawColour';
import { resolveRepoDir } from './repoFile';

/**
 * The general case of a bug this repository has now fixed four times.
 *
 * Jade favicons (#7), a localhost sitemap, an indigo email palette (#10) and
 * the palette's move out of the stylesheet were each a colour that existed in
 * two places at once, and each was found only after a stale value had already
 * reached a real consumer. The gates those fixes produced guard one known
 * consumer apiece. None of them can see a colour typed into a file nobody has
 * written a gate for yet.
 *
 * This asserts the property directly: outside the canonical palette and the
 * files generated from it, no colour value is written out anywhere in `src`.
 */

interface Allowance {
  file: string;
  literal: string;
  why: string;
}

/**
 * The two literals in `src` that are deliberately not tokens.
 *
 * Entries are exact `(file, literal)` pairs rather than whole-file or
 * whole-directory exclusions, and every entry has to match something — see the
 * stale-entry test below. That is what stops this list becoming a way to mute a
 * real finding, which is the only way a gate like this fails in practice.
 */
const ALLOWED: Allowance[] = [
  {
    file: 'client/src/features/dashboard/charts/chartTheme.ts',
    literal: '148 163 184',
    why:
      'The "stylesheet did not load" sentinel, not a brand colour. It is used when a token ' +
      'resolves to an empty string — a server render, or a test that has not injected the ' +
      'token block — because reading nothing would hand Chart.js `rgb( )`, which it silently ' +
      'paints black. Drawing it from the palette would make that failure paint in brand ' +
      'colours and become invisible, which is the opposite of what it is for. It matches no ' +
      'current token deliberately, so a chart rendered in this slate is a visible symptom.',
  },
  {
    file: 'client/src/index.css',
    literal: '#000',
    why:
      'The opaque stop of a `mask-image` radial gradient, where only the alpha channel is ' +
      'read and the colour channels are discarded by the compositor. `#000` is the ' +
      'conventional way to write "fully masked in"; no token could change what it renders.',
  },
];

const isAllowed = (finding: RawColour): boolean =>
  ALLOWED.some((entry) => entry.file === finding.file && entry.literal === finding.literal);

const describeFinding = (finding: RawColour): string =>
  `  ${finding.file}:${String(finding.line)} — ${finding.literal}`;

describe('no raw colour in src', () => {
  const { findings, files } = findRawColours();

  /*
    The scan has to be shown to have happened before its clean result means
    anything. DECISIONS already records writing one drift check that was "close
    to worthless" because it could not fail; a walk that quietly reached an
    empty directory would be that check again.
  */
  it('reads both src trees', () => {
    expect(files.filter((file) => file.startsWith('client/src/')).length).toBeGreaterThan(100);
    expect(files.filter((file) => file.startsWith('server/src/')).length).toBeGreaterThan(50);
  });

  /*
    A skip for a file that no longer exists is a hole nobody can see. If either
    generated file is renamed, this says so rather than leaving the exclusion
    quietly covering a path that will never match again.
  */
  it('skips generated files that still exist', () => {
    for (const file of GENERATED) {
      expect(
        () => resolveRepoDir(file),
        `GENERATED skips ${file}, which is gone. Update the list.`,
      ).not.toThrow();
    }
  });

  /* The assertion itself. */
  it('has no hand-written colour outside the canonical palette', () => {
    const unexpected = findings.filter((finding) => !isAllowed(finding));

    /*
      Thrown rather than asserted, because vitest would otherwise print two
      arrays and leave the reader to work out which literal moved and what to do
      about it. The same reason `mail.palette.test.ts` throws.
    */
    if (unexpected.length > 0) {
      throw new Error(
        `${String(unexpected.length)} hand-written colour value(s) in src:\n` +
          `${unexpected.map(describeFinding).join('\n')}\n\n` +
          'Colours come from the tokens: use a Tailwind class, or ' +
          '`rgb(var(--color-name))` where a raw value is unavoidable. The values live in ' +
          'client/src/theme/tokens.json and every consumer derives from it, because a colour ' +
          'written out in a second place is the bug this repository has already fixed four ' +
          'times. If a literal genuinely cannot be a token, add it to ALLOWED in this file ' +
          'with the reason.',
      );
    }

    expect(unexpected).toEqual([]);
  });

  /*
    An allowlist nobody prunes becomes a list of things that used to be true.
    Both entries below describe a specific line of a specific file; if either
    stops existing, the entry has to go rather than sit here covering a literal
    that might reappear later for a different, worse reason.
  */
  it('has no stale allowlist entries', () => {
    for (const entry of ALLOWED) {
      const matched = findings.filter(
        (finding) => finding.file === entry.file && finding.literal === entry.literal,
      );

      expect(
        matched.length,
        `ALLOWED lists ${entry.literal} in ${entry.file}, but the scan no longer finds it. ` +
          'Remove the entry.',
      ).toBeGreaterThan(0);
    }
  });

  /*
    The comment stripper decides what this gate can see, so it is checked
    directly rather than trusted. If it over-reached, real colours would vanish
    from the scan and every run would pass; that is precisely the silent
    weakening the whole file exists to prevent.
  */
  describe('the comment stripper', () => {
    it('keeps a colour that is code', () => {
      expect(stripComments("const brand = '#682eb3';")).toContain('#682eb3');
    });

    it('drops a colour that is only named in a line comment', () => {
      expect(stripComments('// the old brand was #4f46e5')).not.toContain('#4f46e5');
    });

    it('drops a colour that is only named in a block comment', () => {
      expect(stripComments('/* the old brand was #4f46e5 */')).not.toContain('#4f46e5');
    });

    // The reason this is a character walk and not a regex: a `//` inside a
    // string is not a comment, and treating it as one would blank the rest of
    // the line — hiding any colour that followed a URL.
    it('does not treat a URL inside a string as a comment', () => {
      expect(stripComments("const a = 'https://example.test'; const b = '#682eb3';")).toContain(
        '#682eb3',
      );
    });

    it('preserves offsets, so reported line numbers are the real ones', () => {
      const source = "// a\n/* b */\nconst brand = '#682eb3';\n";
      const stripped = stripComments(source);

      expect(stripped).toHaveLength(source.length);
      expect(stripped.split('\n')).toHaveLength(source.split('\n').length);
    });
  });
});
