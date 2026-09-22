import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusDot } from '@/components/ui/StatusDot';
import type { ApplicationStatus } from '@/types/application';

function dot(status: ApplicationStatus, size?: 'xs' | 'sm' | 'md'): Element {
  const { container } = render(<StatusDot status={status} size={size} />);
  const element = container.querySelector('[data-status-dot]');

  if (!element) throw new Error('StatusDot rendered nothing');

  return element;
}

/**
 * Ghosted's second signal. Colour is asserted by `tests/a11y/tokenContrast`;
 * this is the shape, which has to hold whatever the palette does.
 */
describe('StatusDot', () => {
  it('draws ghosted as a ring in its own colour, with nothing inside', () => {
    const element = dot('ghosted');

    expect(element.getAttribute('data-status-dot')).toBe('hollow');
    expect(element.className).toContain('border-status-ghosted');
    expect(element.className).toContain('bg-transparent');
    expect(element.className).toContain('border-2');
    expect(element.className).not.toContain('bg-status-ghosted');
  });

  it('draws saved as a filled disc', () => {
    const element = dot('saved');

    expect(element.getAttribute('data-status-dot')).toBe('solid');
    expect(element.className).toContain('bg-status-saved');
    expect(element.className).not.toMatch(/\bborder/);
  });

  it('thins the ring at the smallest size so the hole survives', () => {
    const element = dot('ghosted', 'xs');

    expect(element.className).toContain('h-1.5');
    expect(element.className).toMatch(/\bborder\b/);
    expect(element.className).not.toContain('border-2');
  });

  it('is decorative, because every site pairs it with the label as text', () => {
    expect(dot('applied').getAttribute('aria-hidden')).toBe('true');
  });
});
