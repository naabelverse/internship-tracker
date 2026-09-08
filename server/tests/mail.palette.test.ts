import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { renderHtml } from '@/mail/layout';
import { MAIL_PALETTE, MAIL_PALETTE_THEME, MAIL_PALETTE_TOKENS } from '@/mail/palette';

/**
 * The drift check for issue #10, and the server-side twin of
 * `client/tests/config/brandPalette.test.ts`.
 *
 * `mail/layout.ts` declared six hex literals - a templated indigo and five
 * greys - with nothing tying them to `client/src/index.css`, so every
 * transactional email rendered `#4f46e5` for two redesigns after the primary
 * became violet. Deriving them is only half a fix: the generated file has to be
 * committed, because `server/Dockerfile` never copies `client/src` and the
 * stylesheet is therefore not in the server's build context - and a committed
 * artifact is exactly the kind of thing that gets left behind. This is what
 * notices when it is.
 *
 * The stylesheet is read by a reader written separately from the generator's:
 * this one looks up one named declaration at a time, where `brandPalette.mjs`
 * harvests every declaration in the block and keys them. Two readers agreeing
 * proves little on its own, since both read the same file. What the suite
 * actually establishes is that the *committed* values still match the
 * stylesheet the app ships, which is the failure that really happened.
 */

/** Walks up from the working directory, so this runs from `server/` or the root. */
function readRepoFile(relative: string): string {
  let dir = process.cwd();

  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = path.join(dir, relative);
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
    dir = path.dirname(dir);
  }

  throw new Error(`Could not find ${relative} above ${process.cwd()}`);
}

const STYLESHEET = 'client/src/index.css';

/**
 * The `:root` block, which carries the light palette an email is rendered
 * against. `index.css` documents that every declaration in it is a flat
 * `--name: value;`, which is what lets a match bounded by `[^}]*` be correct.
 */
function lightBlock(css: string): string {
  const block = /:root\s*\{([^}]*)\}/.exec(css);

  if (!block?.[1]) throw new Error(`No :root block found in ${STYLESHEET}`);

  return block[1];
}

/**
 * One named token as hex, or `undefined` when the stylesheet no longer has it.
 *
 * Split rather than matched. The declarations are flat and space-separated by
 * the stylesheet's own stated rule, so scanning them reads more plainly than a
 * regex built from an interpolated token name.
 */
function readToken(block: string, token: string): string | undefined {
  for (const declaration of block.split(';')) {
    const [name, value] = declaration.split(':');

    if (name?.trim() !== `--${token}`) continue;

    const channels = (value ?? '').trim().split(' ').filter(Boolean);

    if (channels.length !== 3) return undefined;

    return `#${channels.map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}`;
  }

  return undefined;
}

describe('mail palette', () => {
  const block = lightBlock(readRepoFile(STYLESHEET));

  it('is read from the light theme, the one an email can rely on', () => {
    expect(MAIL_PALETTE_THEME).toBe('light');
  });

  it.each(Object.entries(MAIL_PALETTE_TOKENS))(
    'draws %s from the shipped --%s token',
    (name, token) => {
      const shipped = readToken(block, token);
      const committed = MAIL_PALETTE[name as keyof typeof MAIL_PALETTE];

      /*
        Thrown rather than asserted, because jest's `expect` takes no message
        argument and a bare "expected undefined to be defined" would say nothing
        about which token moved or what to run about it. Both directions this can
        fail in are the reason the file exists, so both say so in words.
      */
      if (shipped === undefined) {
        throw new Error(
          `--${token} is missing from the light theme block of ${STYLESHEET}. The mail palette ` +
            'is derived from the tokens the app ships, so a renamed or deleted token has to be ' +
            'fixed here rather than left to resolve to nothing.',
        );
      }

      if (committed !== shipped) {
        throw new Error(
          `server/src/mail/palette.ts is stale: ${name} is ${committed}, but --${token} is now ` +
            `${shipped}. Run \`npm run mail:palette -w server\` and commit the result.`,
        );
      }

      expect(committed).toBe(shipped);
    },
  );

  it('resolves every colour the layout needs', () => {
    expect(Object.keys(MAIL_PALETTE).sort()).toEqual(Object.keys(MAIL_PALETTE_TOKENS).sort());

    for (const value of Object.values(MAIL_PALETTE)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  // The specific failure this exists to prevent, named rather than implied.
  it('no longer ships the templated palette the redesign replaced', () => {
    const replaced = ['#4f46e5', '#111827', '#6b7280', '#e5e7eb', '#f3f4f6'];

    for (const value of Object.values(MAIL_PALETTE)) {
      expect(replaced).not.toContain(value);
    }
  });

  /*
    Checking the constant is not the same as checking the email.

    The palette could be perfect and the layout still paint a literal, which is
    the state this fix started from. Rendering the shell is what ties the two
    together: the masthead tile and the button have to carry the fill colour,
    and none of the replaced palette may appear in the output at all.
  */
  it('renders an email masthead and button in the derived colours', () => {
    const html = renderHtml({
      heading: 'Confirm your email',
      preheader: 'One click and you are in.',
      blocks: [
        { type: 'paragraph', text: 'Welcome aboard.' },
        { type: 'button', label: 'Verify email', url: 'https://example.test/verify' },
      ],
      footer: { preferencesUrl: 'https://example.test/settings' },
    });

    expect(html).toContain(`background:${MAIL_PALETTE.brandFill}`);
    expect(html).toContain(`color:${MAIL_PALETTE.ink}`);
    expect(html).toContain(`background:${MAIL_PALETTE.canvas}`);

    for (const replaced of ['#4f46e5', '#111827', '#6b7280', '#e5e7eb', '#f3f4f6']) {
      expect(html).not.toContain(replaced);
    }
  });
});
