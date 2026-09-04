import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import CalendarPage from '@/pages/CalendarPage';
import {
  errorBody,
  makeApplication,
  makeCalendarEvent,
  makeSession,
  successBody,
} from '../utils/factories';
import { createGate, installMockApi, type MockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

const CALENDAR = 'GET /calendar';

/**
 * Built from local components rather than a fixed UTC instant: an instant near
 * midnight lands on a different calendar day depending on the runner's timezone,
 * and the grid quite correctly buckets by local day.
 */
function localInstant(day: number, hour: number): string {
  return new Date(2026, 1, day, hour, 0, 0).toISOString();
}

const deadline = makeCalendarEvent({
  id: 'deadline:a1',
  applicationId: 'a1',
  kind: 'deadline',
  at: localInstant(11, 9),
  company: 'Stripe',
});

const interview = makeCalendarEvent({
  id: 'interview:i1',
  applicationId: 'a2',
  kind: 'interview',
  at: localInstant(11, 14),
  company: 'Figma',
  interviewType: 'technical',
  mode: 'video',
});

function renderCalendar(routes: Record<string, Responder> = {}, month = '2026-02'): MockApi {
  const mock = installMockApi({
    [CALENDAR]: () => ({ status: 200, data: successBody({ events: [deadline, interview] }) }),
    ...routes,
  });
  signIn(makeSession());
  renderWithProviders(<App />, { route: `/applications/calendar?month=${month}` });

  return mock;
}

function calendarCalls(mock: MockApi): { from: string; to: string }[] {
  return mock
    .callsTo('GET', '/calendar')
    .map((call) => ({ from: call.params.from, to: call.params.to }));
}

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

describe('calendar rendering', () => {
  it('shows a skeleton before the events arrive', async () => {
    // The page is rendered directly rather than through `<App />`. Since Phase 13
    // this route is lazy, so going through the router would race the chunk load
    // against the request; this case is about the page's own loading state. The
    // response is gated so that state persists long enough to observe.
    const gate = createGate();
    installMockApi({
      [CALENDAR]: async () => {
        await gate.wait;
        return { status: 200, data: successBody({ events: [] }) };
      },
    });
    signIn(makeSession());

    renderWithProviders(<CalendarPage />, { route: '/applications/calendar?month=2026-02' });

    expect(await screen.findByTestId('calendar-skeleton')).toBeInTheDocument();

    gate.open();
  });

  it('shows an error state with a retry when the range fails to load', async () => {
    renderCalendar({
      [CALENDAR]: () => ({
        status: 500,
        data: errorBody('Something went wrong', 'INTERNAL_ERROR'),
      }),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('That did not load');
  });

  it('renders the month named in the URL', async () => {
    renderCalendar();

    expect(await screen.findByText('February 2026')).toBeInTheDocument();
  });

  it('places both events on their day', async () => {
    renderCalendar();
    await screen.findByText('February 2026');

    // The month header renders before the query resolves, so the cell lookup has
    // to wait for the grid rather than assert against the skeleton.
    const day = await screen.findByRole('gridcell', { name: /11 February 2026, 2 events/ });
    expect(within(day).getByText('Stripe')).toBeInTheDocument();
    expect(within(day).getByText('Figma')).toBeInTheDocument();
  });
});

describe('month navigation', () => {
  it('requests the new range from the server rather than filtering one window', async () => {
    const user = userEvent.setup();
    const mock = renderCalendar();
    await screen.findByText('February 2026');

    await waitFor(() => {
      expect(calendarCalls(mock)).toHaveLength(1);
    });
    const [february] = calendarCalls(mock);

    await user.click(screen.getByRole('button', { name: 'Next month' }));

    expect(await screen.findByText('March 2026')).toBeInTheDocument();
    await waitFor(() => {
      expect(calendarCalls(mock)).toHaveLength(2);
    });

    const march = calendarCalls(mock)[1];
    expect(march.from).not.toBe(february.from);
    expect(march.to).not.toBe(february.to);
    expect(new Date(march.from).getTime()).toBeGreaterThan(new Date(february.from).getTime());
  });

  it('walks back a month too', async () => {
    const user = userEvent.setup();
    const mock = renderCalendar();
    await screen.findByText('February 2026');

    await user.click(screen.getByRole('button', { name: 'Previous month' }));

    expect(await screen.findByText('January 2026')).toBeInTheDocument();
    await waitFor(() => {
      expect(calendarCalls(mock).length).toBeGreaterThanOrEqual(2);
    });

    const calls = calendarCalls(mock);
    const january = calls[calls.length - 1];
    expect(new Date(january.from).getTime()).toBeLessThan(new Date('2026-02-01').getTime());
  });

  it('covers the leading and trailing days borrowed from adjacent months', async () => {
    const mock = renderCalendar();
    await screen.findByText('February 2026');

    await waitFor(() => {
      expect(calendarCalls(mock)).toHaveLength(1);
    });

    // February 2026 opens on a Sunday, so the grid starts in late January. The
    // request has to reach that far or those cells would look empty when they
    // are not.
    const [range] = calendarCalls(mock);
    expect(new Date(range.from).getTime()).toBeLessThan(new Date('2026-02-01').getTime());
    expect(new Date(range.to).getTime()).toBeGreaterThan(new Date('2026-02-28').getTime());
  });
});

describe('day selection', () => {
  it('lists the events for the day that was clicked', async () => {
    const user = userEvent.setup();
    renderCalendar();
    await screen.findByText('February 2026');

    await user.click(await screen.findByRole('gridcell', { name: /11 February 2026/ }));

    const panel = screen.getByRole('region', { name: /Wednesday 11 February/ });
    expect(within(panel).getByText(/Application deadline/)).toBeInTheDocument();
    expect(within(panel).getByText(/Technical/)).toBeInTheDocument();
  });

  it('opens the application detail page when an event is clicked', async () => {
    const user = userEvent.setup();
    renderCalendar({
      'GET /applications/a1': () => ({
        status: 200,
        data: successBody({ application: makeApplication({ id: 'a1', company: 'Stripe' }) }),
      }),
    });
    await screen.findByText('February 2026');

    await user.click(await screen.findByRole('gridcell', { name: /11 February 2026/ }));
    const panel = screen.getByRole('region', { name: /Wednesday 11 February/ });
    await user.click(within(panel).getAllByRole('button')[0]);

    expect(await screen.findByRole('heading', { level: 1, name: 'Stripe' })).toBeInTheDocument();
  });
});
