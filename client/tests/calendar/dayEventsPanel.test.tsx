import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DayEventsPanel } from '@/features/calendar/DayEventsPanel';
import { EVENT_KIND_CONFIG } from '@/lib/statusConfig';
import type { CalendarEvent } from '@/types/calendar';
import { makeCalendarEvent } from '../utils/factories';
import { composite, contrastRatio, readThemeTokens } from '../utils/contrast';

/** WCAG AA for a graphical object such as the event dot. */
const AA_NON_TEXT = 3;

const KINDS: CalendarEvent['kind'][] = ['deadline', 'interview'];

function renderPanel(): HTMLElement {
  const day = new Date(2026, 1, 11);
  const events = KINDS.map((kind) =>
    makeCalendarEvent({
      id: `${kind}:1`,
      kind,
      at: new Date(2026, 1, 11, 9).toISOString(),
    }),
  );
  const { container } = render(
    <DayEventsPanel date={day} month={day} events={events} onOpenApplication={() => undefined} />,
  );

  return container;
}

function dotOf(container: HTMLElement, kind: CalendarEvent['kind']): HTMLElement {
  const dot = container.querySelector<HTMLElement>(`[data-event-dot="${kind}"]`);
  if (!dot) throw new Error(`No ${kind} dot rendered`);
  return dot;
}

/**
 * Issue #100: the day panel's dots used the month grid's chip tint, and on a
 * dot only that 15% fill paints, about 1.3:1. They now share the Upcoming
 * panel's solid dot, so the two panels agree.
 */
describe('day panel event dots', () => {
  it.each(KINDS)('gives a %s the Upcoming panel’s solid dot, not the chip tint', (kind) => {
    const dot = dotOf(renderPanel(), kind);

    expect(dot).toHaveClass(EVENT_KIND_CONFIG[kind].dot);
    expect(dot.className).not.toMatch(/\/\d+/);
  });

  it.each(KINDS)('keeps the %s dot hidden from assistive technology', (kind) => {
    expect(dotOf(renderPanel(), kind)).toHaveAttribute('aria-hidden', 'true');
  });

  it('gives the two kinds different dots', () => {
    const container = renderPanel();

    expect(dotOf(container, 'deadline').className).not.toBe(
      dotOf(container, 'interview').className,
    );
  });

  /**
   * Measured from the class the panel actually renders, against the card's
   * fill at rest (the panel's `surface`, since the card paints none) and on
   * hover (`surface-muted`), so a tint or a token edit that sinks a dot fails.
   */
  describe.each(['light', 'dark'] as const)('%s theme', (theme) => {
    const tokens = readThemeTokens(theme);
    const token = (name: string) => {
      const value = tokens[`color-${name}`];
      if (!value) throw new Error(`Missing token --color-${name} in the ${theme} block`);
      return value;
    };

    it.each(KINDS)('paints the %s dot at 3:1 or more against the card', (kind) => {
      const match = /(?:^|\s)bg-([a-z-]+)(?:\/(\d+))?(?:\s|$)/.exec(
        dotOf(renderPanel(), kind).className,
      );
      if (!match) throw new Error(`The ${kind} dot has no bg- colour class`);
      const alpha = match[2] ? Number(match[2]) / 100 : 1;

      for (const card of [token('surface'), token('surface-muted')]) {
        const painted = composite(token(match[1]), card, alpha);
        expect(contrastRatio(painted, card)).toBeGreaterThanOrEqual(AA_NON_TEXT);
      }
    });
  });
});

/**
 * The card has no fill of its own on the panel's surface, so its border is the
 * whole boundary; `border-strong` replaced the app-wide `border` deliberately.
 */
describe('day panel event cards', () => {
  it('draws each card with the strong border token', () => {
    const cards = renderPanel().querySelectorAll('li > button');

    expect(cards).toHaveLength(KINDS.length);
    for (const card of cards) {
      expect(card).toHaveClass('border-border-strong');
      expect(card).not.toHaveClass('border-border');
    }
  });
});
