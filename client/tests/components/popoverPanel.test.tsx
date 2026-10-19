import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Popover } from '@/components/ui/Popover';

/**
 * The toolbar menus (Filters, Columns, Export CSV) are `Popover`'s default
 * panel, a list that scrolls past 20rem. Its scrollbar is drawn just inside the
 * border, so on the plain card (`border p-2`) it ran flush against the edge and
 * painted over both right-hand corners. The default panel is now the select's
 * `.scroll-panel`; a panel given its own classes (the calendar, InfoTip) keeps
 * the plain card. jsdom applies no CSS, so the geometry is held in
 * `e2e/audits/popoverScrollbar.spec.ts`; this holds the contract.
 */

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

async function openPanel(panelClassName?: string): Promise<string[]> {
  const user = userEvent.setup();
  render(
    <Popover label="Filters" trigger="Filters" panelClassName={panelClassName}>
      {() => <p>Panel content</p>}
    </Popover>,
  );
  await user.click(screen.getByRole('button', { name: 'Filters' }));

  return screen.getByRole('group', { name: 'Filters' }).className.split(/\s+/);
}

describe("Popover's panel", () => {
  it('is the shared scrolling panel by default, inset by its border', async () => {
    const classes = await openPanel();

    expect(classes).toContain('scroll-panel');
    expect(classes).toContain('overflow-y-auto');
    expect(classes, '4px of border plus 5px keeps content where `border p-2` put it').toContain(
      'p-[5px]',
    );
    // The card's 1px border would override the inset, and `shadow-float`'s lit
    // edge would land 4px below the outline.
    expect(classes).not.toContain('border');
    expect(classes).not.toContain('shadow-float');
    expect(classes).not.toContain('p-2');
  });

  it('keeps the plain card for a panel given its own classes', async () => {
    const classes = await openPanel('p-3');

    expect(classes).not.toContain('scroll-panel');
    for (const utility of [
      'rounded-card',
      'border',
      'border-border',
      'bg-surface',
      'shadow-float',
      'p-3',
    ]) {
      expect(classes).toContain(utility);
    }
  });

  it('themes the scrollbar and keeps the edge in forced colours', () => {
    const rule = /(?:[{}]|\*\/)\s*\.scroll-panel\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(rule).toMatch(/scrollbar-width: thin;/);
    expect(rule).toMatch(/scrollbar-color: rgb\(var\(--color-border-strong\)\) transparent;/);
    expect(css).toMatch(
      /@media \(forced-colors: active\)\s*\{\s*\.scroll-panel\s*\{\s*border-color: Canvas;/,
    );
  });
});

/**
 * Issue #85: a menu was placed with CSS alone (`absolute right-0` or `left-0`),
 * so at 375px Columns opened 117px off the left edge and Filters off the right.
 * Every panel is now placed from its trigger's box and kept inside the page's
 * 16px gutter. jsdom has no layout, so the boxes are stubbed: a 360px page (a
 * 375px window less its scrollbar) and a 240x200 panel.
 */
describe("Popover's panel placement", () => {
  let triggerBox = new DOMRect(0, 100, 90, 36);

  function stubLayout(): void {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function box(
      this: Element,
    ) {
      if (this === document.documentElement) return new DOMRect(0, 0, 360, 900);
      if (this.tagName === 'BUTTON') return triggerBox;
      return new DOMRect();
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(240);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function open(align: 'left' | 'right', trigger = 'Menu') {
    stubLayout();
    const user = userEvent.setup();
    const view = render(
      <Popover label="Menu" trigger={trigger} align={align}>
        {() => <p>Panel content</p>}
      </Popover>,
    );
    await user.click(screen.getByRole('button', { name: trigger }));

    return { ...view, panel: screen.getByRole('group', { name: 'Menu' }) };
  }

  it('keeps a right-aligned menu off the left edge', async () => {
    triggerBox = new DOMRect(33, 100, 90, 36);
    const { panel } = await open('right');

    // `right-0` would put it at 123 - 240 = -117.
    expect(panel).toHaveClass('fixed');
    expect(panel.style.left).toBe('16px');
    expect(panel.style.top).toBe('144px');
  });

  it('keeps a left-aligned menu off the right edge', async () => {
    triggerBox = new DOMRect(255, 100, 90, 36);
    const { panel } = await open('left');

    // `left-0` would end it at 255 + 240 = 495, past the 360px page.
    expect(panel.style.left).toBe('104px');
  });

  it('follows its trigger when a re-render moves it', async () => {
    triggerBox = new DOMRect(100, 100, 90, 36);
    const { panel, rerender } = await open('left');
    expect(panel.style.left).toBe('100px');

    // A count badge appears and the toolbar re-flows, with no scroll or resize.
    triggerBox = new DOMRect(76, 100, 114, 36);
    rerender(
      <Popover label="Menu" trigger="Menu" align="left">
        {() => <p>Panel content 2</p>}
      </Popover>,
    );

    expect(panel.style.left).toBe('76px');
  });
});
