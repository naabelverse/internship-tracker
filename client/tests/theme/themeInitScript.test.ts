import { JSDOM, type DOMWindow } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY } from '@/store/themeStore';
// `?raw` gives the byte-for-byte shipped document, so these cases run against the
// same file the browser loads rather than a copy of the script kept in the test.
import html from '../../index.html?raw';

interface BootOptions {
  stored?: string;
  prefersLight?: boolean;
  storageThrows?: boolean;
}

/**
 * Parses the real `index.html` with scripts enabled and returns the document
 * element as it stands once parsing finishes.
 *
 * This is the closest a headless check can get to the property that matters. The
 * browser guarantee is "the theme is on the document before the first paint", and
 * it has two halves: the script's logic, and its position. Executing the shipped
 * file through a real HTML parser proves the logic against the exact source that
 * ships, and the position assertions below prove a classic, non-deferred script in
 * <head> — which the HTML spec requires the parser to run before it reaches <body>,
 * so nothing has been laid out, let alone painted. The only untested link is the
 * browser's own parse-then-paint ordering, which is not application code. Phase 15
 * closes that end to end by asserting the painted background in Playwright.
 */
function boot({ stored, prefersLight = false, storageThrows = false }: BootOptions = {}): {
  root: HTMLElement;
} {
  const dom = new JSDOM(html, {
    // An explicit origin is required before jsdom will hand out localStorage;
    // the default `about:blank` is an opaque origin with no storage at all.
    url: 'https://tracker.test/',
    runScripts: 'dangerously',
    beforeParse(window: DOMWindow) {
      if (storageThrows) {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new Error('Storage is disabled in this browsing mode');
          },
        });
      } else if (stored !== undefined) {
        window.localStorage.setItem(THEME_STORAGE_KEY, stored);
      }

      window.matchMedia = (query: string) =>
        ({
          matches: query.includes('prefers-color-scheme: light') ? prefersLight : !prefersLight,
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList;
    },
  });

  return { root: dom.window.document.documentElement };
}

describe('inline theme boot script', () => {
  it('applies a stored light preference', () => {
    const { root } = boot({ stored: 'light' });

    expect(root.getAttribute('data-theme')).toBe('light');
    expect(root.style.colorScheme).toBe('light');
  });

  it('applies a stored dark preference', () => {
    const { root } = boot({ stored: 'dark' });

    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('defaults to dark when nothing has been stored', () => {
    const { root } = boot();

    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('ignores a stored value that is not a known preference', () => {
    const { root } = boot({ stored: 'sepia' });

    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('follows the operating system when the preference is system', () => {
    expect(boot({ stored: 'system', prefersLight: true }).root.getAttribute('data-theme')).toBe(
      'light',
    );
    expect(boot({ stored: 'system', prefersLight: false }).root.getAttribute('data-theme')).toBe(
      'dark',
    );
  });

  it('falls back to the default rather than throwing when storage is blocked', () => {
    const { root } = boot({ storageThrows: true });

    expect(root.getAttribute('data-theme')).toBe('dark');
  });
});

describe('inline theme boot script placement', () => {
  const scriptTag = /<script data-theme-init>([\s\S]*?)<\/script>/.exec(html);

  it('is present as a classic inline script', () => {
    expect(scriptTag).not.toBeNull();
    expect(html).not.toMatch(/<script data-theme-init[^>]*\b(defer|async|type="module")/);
  });

  it('runs before the app bundle and before the root element exists', () => {
    const scriptIndex = html.indexOf('<script data-theme-init>');
    const headEnd = html.indexOf('</head>');
    const rootIndex = html.indexOf('<div id="root">');
    const bundleIndex = html.indexOf('src="/src/main.tsx"');

    expect(scriptIndex).toBeGreaterThan(-1);
    expect(scriptIndex).toBeLessThan(headEnd);
    expect(scriptIndex).toBeLessThan(rootIndex);
    expect(scriptIndex).toBeLessThan(bundleIndex);
  });

  it('reads the same storage key the theme store writes', () => {
    expect(scriptTag?.[1]).toContain(`'${THEME_STORAGE_KEY}'`);
  });

  it('ships a document element that already carries a theme, so the first paint is never unthemed', () => {
    expect(html).toMatch(/<html[^>]*data-theme="dark"/);
  });
});
