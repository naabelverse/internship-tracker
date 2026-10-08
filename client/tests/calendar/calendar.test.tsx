import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { format } from 'date-fns';
import { App } from '@/App';
import CalendarPage from '@/pages/CalendarPage';
import {
  errorBody,
  makeApplication,
  makeCalendarEvent,
  makeSession,
  makeUser,
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

function renderCalendar(
  routes: Record<string, Responder> = {},
  month = '2026-02',
  session = makeSession(),
): MockApi {
  const mock = installMockApi({
    [CALENDAR]: () => ({ status: 200, data: successBody({ events: [deadline, interview] }) }),
    ...routes,
  });
  signIn(session);
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

/** What a sighted user reads: the text with the screen-reader-only spans removed. */
function visibleText(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll('.sr-only').forEach((node) => {
    node.remove();
  });
  return copy.textContent ?? '';
}

/** The card's last line: the description and the time. */
function cardLine(card: HTMLElement): Element {
  const line = card.lastElementChild;
  if (line === null) throw new Error('card has no lines');
  return line;
}

function respondWith(...events: ReturnType<typeof makeCalendarEvent>[]): Record<string, Responder> {
  return { [CALENDAR]: () => ({ status: 200, data: successBody({ events }) }) };
}

describe('day panel cards', () => {
  it('shows the time alone, keeping the full date for screen readers and in <time>', async () => {
    const at = new Date(2026, 1, 11, 21, 20).toISOString();
    const user = userEvent.setup();
    renderCalendar(
      respondWith(
        makeCalendarEvent({
          kind: 'interview',
          at,
          company: 'Figma',
          interviewType: 'technical',
          mode: 'video',
        }),
      ),
    );

    await user.click(await screen.findByRole('gridcell', { name: /^11 February 2026/ }));

    const panel = screen.getByRole('region', { name: 'Wednesday 11 February' });
    const card = within(panel).getByRole('button', {
      name: /Technical · Video · 11 Feb 2026, 21:20$/,
    });
    expect(visibleText(cardLine(card))).toBe('Technical · Video · 21:20');
    expect(cardLine(card).querySelector('time')).toHaveAttribute('datetime', at);
  });

  it('shows no time on a date-only deadline, and its grid day for screen readers', async () => {
    // Stored the way the form stores a deadline: the day at midnight UTC. It sits
    // under whichever local day that instant falls on, and the card must agree.
    const at = '2026-02-11T00:00:00.000Z';
    const local = new Date(at);
    const user = userEvent.setup();
    renderCalendar(respondWith(makeCalendarEvent({ kind: 'deadline', at, company: 'Stripe' })));

    await user.click(
      await screen.findByRole('gridcell', { name: new RegExp(`^${format(local, 'd MMMM yyyy')}`) }),
    );

    const panel = screen.getByRole('region', { name: format(local, 'EEEE d MMMM') });
    const card = within(panel).getByRole('button', {
      name: new RegExp(`Application deadline ?, ${format(local, 'd MMM yyyy')}$`),
    });
    expect(visibleText(cardLine(card))).toBe('Application deadline');
    expect(cardLine(card).querySelector('time')).toHaveAttribute('datetime', at);
  });

  it('keeps the time on a deadline that has one', async () => {
    const at = new Date(2026, 1, 11, 22, 45).toISOString();
    const user = userEvent.setup();
    renderCalendar(respondWith(makeCalendarEvent({ kind: 'deadline', at, company: 'Stripe' })));

    await user.click(await screen.findByRole('gridcell', { name: /^11 February 2026/ }));

    const card = within(screen.getByRole('region')).getByRole('button');
    expect(visibleText(cardLine(card))).toBe('Application deadline · 22:45');
  });

  /**
   * Fixed instants near midnight, read in the runner's own timezone, which is the
   * browser timezone in the app. Run the suite under TZ=UTC, Asia/Kuala_Lumpur and
   * America/Los_Angeles: each run checks the zone it is in, and the account
   * timezones differ from it, which must change nothing.
   */
  const NEAR_MIDNIGHT = [
    makeCalendarEvent({ kind: 'interview', at: '2026-02-11T16:30:00.000Z', company: 'Grab' }),
    makeCalendarEvent({ kind: 'interview', at: '2026-02-12T07:50:00.000Z', company: 'Shopee' }),
  ];
  const BY_ZONE: Record<string, { cell: string; heading: string; times: string[] }[]> = {
    UTC: [
      { cell: '11 February 2026', heading: 'Wednesday 11 February', times: ['16:30'] },
      { cell: '12 February 2026', heading: 'Thursday 12 February', times: ['07:50'] },
    ],
    'Asia/Kuala_Lumpur': [
      { cell: '11 February 2026', heading: 'Wednesday 11 February', times: [] },
      { cell: '12 February 2026', heading: 'Thursday 12 February', times: ['00:30', '15:50'] },
    ],
    'America/Los_Angeles': [
      { cell: '11 February 2026', heading: 'Wednesday 11 February', times: ['08:30', '23:50'] },
      { cell: '12 February 2026', heading: 'Thursday 12 February', times: [] },
    ],
  };
  const runnerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const expected = BY_ZONE[runnerZone === 'Etc/UTC' ? 'UTC' : runnerZone];

  it
    .skipIf(expected === undefined)
    .each(['Asia/Kuala_Lumpur', 'America/Los_Angeles', 'Pacific/Kiritimati'])(
    'puts each time under the day it names in the browser timezone, whatever the account says (%s)',
    async (accountZone) => {
      const user = userEvent.setup();
      renderCalendar(
        respondWith(...NEAR_MIDNIGHT),
        '2026-02',
        makeSession({ user: makeUser({ timezone: accountZone }) }),
      );

      for (const day of expected ?? []) {
        await user.click(await screen.findByRole('gridcell', { name: new RegExp(`^${day.cell}`) }));
        const panel = screen.getByRole('region', { name: day.heading });
        const times = within(panel)
          .queryAllByRole('button')
          .map((card) => visibleText(cardLine(card)).replace('Interview · ', ''));
        expect(times).toEqual(day.times);
      }
    },
  );
});

describe('day panel heading', () => {
  beforeEach(() => {
    // Only `Date` is faked, so user-event and the query client keep real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 9, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['2026-07', '5 July 2026', 'Sunday 5 July'],
    ['2027-01', '28 December 2026', 'Monday 28 December 2026'],
    ['2027-03', '3 March 2027', 'Wednesday 3 March 2027'],
  ])('viewing %s and picking %s reads "%s"', async (month, cell, name) => {
    const user = userEvent.setup();
    renderCalendar(respondWith(), month);

    await user.click(await screen.findByRole('gridcell', { name: new RegExp(`^${cell}`) }));

    expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
  });
});
