import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MonthGrid } from '@/features/calendar/MonthGrid';
import { buildMonthGrid } from '@/features/calendar/monthModel';
import { makeCalendarEvent } from '../utils/factories';

/**
 * A `<button>` centres its content vertically, so a day cell with no events
 * showed its number halfway down while a day with events showed it at the top.
 * jsdom does no layout, so this pins the mechanism: every cell is a top-aligned
 * column, whether or not it has events.
 */
describe('month grid day cells', () => {
  it('stacks every cell from the top, with or without events', () => {
    const month = new Date(2026, 1, 1);
    const events = [makeCalendarEvent({ at: new Date(2026, 1, 11, 9).toISOString() })];
    render(
      <MonthGrid
        days={buildMonthGrid(month, events, 'UTC', month)}
        selectedDate={null}
        onSelectDay={() => undefined}
      />,
    );

    const busy = screen.getByRole('gridcell', { name: /^11 February 2026, 1 events/ });
    const empty = screen.getByRole('gridcell', { name: /^12 February 2026, 0 events/ });

    for (const cell of [busy, empty]) {
      expect(cell).toHaveClass('flex', 'flex-col', 'items-start');
    }
  });
});
