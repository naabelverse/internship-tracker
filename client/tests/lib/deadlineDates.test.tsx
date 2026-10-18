import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UpcomingRow } from '@/features/dashboard/UpcomingRow';
import { daysUntil, formatDate } from '@/lib/formatters';

// Issue #99 only shows west of UTC, where 00:00 UTC is still the previous day.
// Node reads TZ when it changes, and each test file runs in its own worker, so
// this file runs in Los Angeles whatever zone CI or the developer is in.
process.env.TZ = 'America/Los_Angeles';

/** The form's date-only deadline for 5 July: the day at 00:00 UTC. */
const FIFTH_OF_JULY = '2026-07-05T00:00:00.000Z';

describe('date-only deadlines west of UTC', () => {
  it('runs in Los Angeles', () => {
    expect(new Date(FIFTH_OF_JULY).getDate()).toBe(4);
  });

  it('formats as the date it names, not the previous day', () => {
    expect(formatDate(FIFTH_OF_JULY)).toBe('5 Jul 2026');
  });

  it('still formats an instant with a time on its local day', () => {
    // 03:00 UTC on 5 July is 20:00 on 4 July in Los Angeles.
    expect(formatDate('2026-07-05T03:00:00.000Z')).toBe('4 Jul 2026');
  });

  it('counts days to the date it names', () => {
    expect(daysUntil(FIFTH_OF_JULY, new Date(2026, 6, 5, 9))).toBe(0);
    expect(daysUntil(FIFTH_OF_JULY, new Date(2026, 6, 2, 23))).toBe(3);
  });

  it('shows the date with no invented time on the Upcoming panel', () => {
    render(
      <UpcomingRow event={{ kind: 'deadline', at: FIFTH_OF_JULY, company: 'Grab', role: 'SWE' }} />,
    );

    expect(screen.getByText('5 Jul 2026')).toBeInTheDocument();
  });
});
