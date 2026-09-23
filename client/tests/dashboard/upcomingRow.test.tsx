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
});
