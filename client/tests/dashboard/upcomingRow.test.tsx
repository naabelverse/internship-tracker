import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UpcomingRow } from '@/features/dashboard/UpcomingRow';
import { makeCalendarEvent } from '../utils/factories';
import { renderWithProviders } from '../utils/render';

/**
 * The row the dashboard's upcoming panel and the landing hero both render. The
 * urgency colour is computed here from the date, which is what lets the hero
 * show amber without being told to.
 */

const MS_PER_DAY = 86_400_000;

function inDays(days: number): string {
  return new Date(Date.now() + days * MS_PER_DAY).toISOString();
}

function dateLine(): HTMLElement {
  return screen.getByText(/^(in |.* ago$)/);
}

describe('UpcomingRow', () => {
  it('turns the date amber inside three days', () => {
    renderWithProviders(<UpcomingRow event={makeCalendarEvent({ at: inDays(2) })} />);

    expect(dateLine()).toHaveTextContent('in 2 days');
    expect(dateLine()).toHaveClass('text-warning');
  });

  it('leaves a date further out in the quiet grey', () => {
    renderWithProviders(<UpcomingRow event={makeCalendarEvent({ at: inDays(6) })} />);

    expect(dateLine()).toHaveClass('text-content-subtle');
    expect(dateLine()).not.toHaveClass('text-warning');
  });

  it('turns an overdue date red', () => {
    renderWithProviders(<UpcomingRow event={makeCalendarEvent({ at: inDays(-2) })} />);

    expect(dateLine()).toHaveClass('text-danger');
  });

  it('is a link when it has somewhere to go, and plain when it does not', () => {
    const event = makeCalendarEvent({ company: 'Grab', at: inDays(5) });
    const { unmount } = renderWithProviders(<UpcomingRow event={event} to="/applications/a1" />);

    expect(screen.getByRole('link', { name: /grab/i })).toHaveAttribute('href', '/applications/a1');
    unmount();

    renderWithProviders(<UpcomingRow event={event} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Grab')).toBeInTheDocument();
  });

  // jsdom paints nothing, so this holds the class contract; the colour was checked in a browser.
  it('hovers with the select panel’s inset ink wash, and only when it is a link', () => {
    const event = makeCalendarEvent({ company: 'Grab', at: inDays(5) });
    const { unmount } = renderWithProviders(<UpcomingRow event={event} to="/applications/a1" />);

    const link = screen.getByRole('link', { name: /grab/i });
    expect(link).toHaveClass('hover:bg-primary/5');
    expect(link).not.toHaveClass('hover:bg-surface-muted');
    // The tint clears the dot and the date by 8px. The panel's list, not the row,
    // takes that 8px from the card's padding, so the dividers span the tint too.
    expect(link).toHaveClass('px-2');
    expect(link).not.toHaveClass('-mx-2');
    unmount();

    renderWithProviders(<UpcomingRow event={event} />);
    const plain = screen.getByText('Grab').closest('[data-upcoming-row]')?.className;
    expect(plain).not.toMatch(/hover:/);
    expect(plain).not.toMatch(/(^|\s)(-mx-2|px-2)(\s|$)/);
  });
});
