import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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
