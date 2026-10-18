import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
 * The calendar reads every instant in the account's zone (issue #98), so a fixed
 * UTC instant and a fixed account zone give the same grid on any runner, in any
 * `TZ`. The default account here is UTC so the instants read as written.
 */
const sessionIn = (timezone: string): ReturnType<typeof makeSession> =>
  makeSession({ user: makeUser({ timezone }) });

const deadline = makeCalendarEvent({
  id: 'deadline:a1',
  applicationId: 'a1',
  kind: 'deadline',
  at: '2026-02-11T09:00:00.000Z',
  company: 'Stripe',
});

const interview = makeCalendarEvent({
  id: 'interview:i1',
  applicationId: 'a2',
  kind: 'interview',
  at: '2026-02-11T14:00:00.000Z',
  company: 'Figma',
  interviewType: 'technical',
  mode: 'video',
});

function renderCalendar(
  routes: Record<string, Responder> = {},
  month = '2026-02',
  session = sessionIn('UTC'),
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

  it('covers the borrowed days, with room for any account zone on either side', async () => {
    const mock = renderCalendar();
    await screen.findByText('February 2026');

    await waitFor(() => {
      expect(calendarCalls(mock)).toHaveLength(1);
    });

    // February 2026 opens on a Sunday, so the grid runs 26 Jan to 1 Mar. The
    // request has to reach that far, plus the 26 hours that can separate the
    // account's zone from the browser's, or edge cells would look empty.
    const [range] = calendarCalls(mock);
    expect(new Date(range.from).getTime()).toBeLessThanOrEqual(
      new Date('2026-01-25T00:00:00Z').getTime(),
    );
    expect(new Date(range.to).getTime()).toBeGreaterThanOrEqual(
      new Date('2026-03-03T00:00:00Z').getTime(),
    );
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
    const at = '2026-02-11T21:20:00.000Z';
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

  // Issue #99: stored the way the form stores a deadline, the day at 00:00 UTC.
  // It names 11 February everywhere: not 10 February at 16:00 in Los Angeles,
  // and not 11 February "at 08:00" in Kuala Lumpur.
  it.each(['America/Los_Angeles', 'Asia/Kuala_Lumpur', 'Pacific/Kiritimati'])(
    'puts a date-only deadline on the date it names, with no time, for an account in %s',
    async (accountZone) => {
      const at = '2026-02-11T00:00:00.000Z';
      const user = userEvent.setup();
      renderCalendar(
        respondWith(makeCalendarEvent({ kind: 'deadline', at, company: 'Stripe' })),
        '2026-02',
        sessionIn(accountZone),
      );

      await user.click(await screen.findByRole('gridcell', { name: /^11 February 2026, 1 event/ }));

      const panel = screen.getByRole('region', { name: 'Wednesday 11 February' });
      const card = within(panel).getByRole('button', {
        name: /Application deadline ?, 11 Feb 2026$/,
      });
      expect(visibleText(cardLine(card))).toBe('Application deadline');
      expect(cardLine(card).querySelector('time')).toHaveAttribute('datetime', at);
    },
  );

  it('keeps the time on a deadline that has one', async () => {
    const at = '2026-02-11T22:45:00.000Z';
    const user = userEvent.setup();
    renderCalendar(respondWith(makeCalendarEvent({ kind: 'deadline', at, company: 'Stripe' })));

    await user.click(await screen.findByRole('gridcell', { name: /^11 February 2026/ }));

    const card = within(screen.getByRole('region')).getByRole('button');
    expect(visibleText(cardLine(card))).toBe('Application deadline · 22:45');
  });

  /**
   * Issue #98: fixed instants near midnight, read in the account's zone, the one
   * the reminder emails use. The runner's own zone plays no part, so every row
   * runs on every runner (issue #102: CI used to check only its own UTC row).
   */
  const NEAR_MIDNIGHT = [
    makeCalendarEvent({ kind: 'interview', at: '2026-02-11T16:30:00.000Z', company: 'Grab' }),
    makeCalendarEvent({ kind: 'interview', at: '2026-02-12T07:50:00.000Z', company: 'Shopee' }),
  ];
  const BY_ACCOUNT_ZONE: [string, { cell: string; heading: string; times: string[] }[]][] = [
    [
      'UTC',
      [
        { cell: '11 February 2026', heading: 'Wednesday 11 February', times: ['16:30'] },
        { cell: '12 February 2026', heading: 'Thursday 12 February', times: ['07:50'] },
      ],
    ],
    [
      'Asia/Kuala_Lumpur',
      [
        { cell: '11 February 2026', heading: 'Wednesday 11 February', times: [] },
        { cell: '12 February 2026', heading: 'Thursday 12 February', times: ['00:30', '15:50'] },
      ],
    ],
    [
      'America/Los_Angeles',
      [
        { cell: '11 February 2026', heading: 'Wednesday 11 February', times: ['08:30', '23:50'] },
        { cell: '12 February 2026', heading: 'Thursday 12 February', times: [] },
      ],
    ],
    [
      'Pacific/Kiritimati',
      [
        { cell: '11 February 2026', heading: 'Wednesday 11 February', times: [] },
        { cell: '12 February 2026', heading: 'Thursday 12 February', times: ['06:30', '21:50'] },
      ],
    ],
  ];

  it.each(BY_ACCOUNT_ZONE)(
    'puts each time under the day it names in the account timezone (%s)',
    async (accountZone, expected) => {
      const user = userEvent.setup();
      renderCalendar(respondWith(...NEAR_MIDNIGHT), '2026-02', sessionIn(accountZone));

      for (const day of expected) {
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
