import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityHeatmap } from '@/features/dashboard/ActivityHeatmap';
import { FollowThrough } from '@/features/dashboard/FollowThrough';
import { TimelineChart } from '@/features/dashboard/charts/TimelineChart';
import { Chart } from '@/features/dashboard/charts/chartRegistry';
import {
  countActiveDays,
  followThroughText,
  summarizeFollowThrough,
} from '@/features/dashboard/followThroughStats';
import { buildCells } from '@/features/dashboard/heatmapCells';
import { statusUpdates } from '@/features/dashboard/statusUpdates';
import type { Cell } from '@/features/dashboard/heatmapCells';
import type { TimelinePoint } from '@/types/analytics';
import { makeTimeline, makeTimelinePoint, makeWeeksOfCells } from '../utils/factories';
import { resetClientState } from '../utils/render';
import { installThemeTokens, removeThemeTokens } from '../utils/themeTokens';

/*
  Every application's status history opens with a `from: null` entry written
  as it is created, and the server's `statusChanges` counts it. Shown raw, each
  new application was also one "status change". These pin the correction —
  statusChanges − created — and that the raw figure reaches no screen.

  The demo account on Friday 2 Oct 2026 in Kuala Lumpur is the worked case: its
  grid of 13 Jul – 4 Oct holds 41 applications added and 94 raw status
  changes, so 53 real moves, 1.3 for every application added.
*/

const KL = 'Asia/Kuala_Lumpur';
const NOW = new Date('2026-10-02T12:16:00Z');

/** The demo account's twelve grid weeks, oldest first: [added, raw status changes]. */
const DEMO_WEEKS: [number, number][] = [
  [1, 2],
  [4, 4],
  [4, 8],
  [3, 10],
  [1, 7],
  [6, 8],
  [3, 10],
  [3, 8],
  [1, 5],
  [2, 8],
  [8, 15],
  [5, 9],
];
const DEMO_ADDED = 41;
const DEMO_RAW = 94;
const DEMO_UPDATES = 53;

/** Local midnight in Kuala Lumpur, as the UTC instant the server sends. */
function klDay(key: string, plusDays = 0): string {
  return new Date(Date.parse(`${key}T00:00:00+08:00`) + plusDays * 86_400_000).toISOString();
}

/** One bucket on each grid week's Wednesday, plus one in the week before the grid. */
function demoPoints(): TimelinePoint[] {
  return [
    // 6 Jul: inside the server's 90 days, outside the grid's twelve weeks.
    makeTimelinePoint({ bucket: klDay('2026-07-06'), created: 1, statusChanges: 7 }),
    ...DEMO_WEEKS.map(([created, statusChanges], week) =>
      makeTimelinePoint({ bucket: klDay('2026-07-13', week * 7 + 2), created, statusChanges }),
    ),
  ];
}

describe('statusUpdates', () => {
  it('takes away the opening entry each new application adds to the raw count', () => {
    expect(statusUpdates(makeTimelinePoint({ created: 3, statusChanges: 7 }))).toBe(4);
  });

  it('is the raw count when nothing was added that day', () => {
    expect(statusUpdates(makeTimelinePoint({ created: 0, statusChanges: 5 }))).toBe(5);
  });

  it('is zero on a day of additions only, not the number added', () => {
    expect(statusUpdates(makeTimelinePoint({ created: 4, statusChanges: 4 }))).toBe(0);
  });

  it('never goes below zero', () => {
    expect(statusUpdates(makeTimelinePoint({ created: 2, statusChanges: 1 }))).toBe(0);
  });
});

describe('buildCells', () => {
  it('puts each day’s corrected updates on that local day', () => {
    const cells = buildCells(
      [makeTimelinePoint({ bucket: klDay('2026-10-01'), created: 2, statusChanges: 5 })],
      NOW,
      KL,
    );
    const day = cells.find((cell) => cell.key === '2026-10-01');

    expect(day).toEqual({ key: '2026-10-01', count: 2, updates: 3 });
    expect(cells.reduce((sum, cell) => sum + cell.updates, 0)).toBe(3);
  });
});

describe('summarizeFollowThrough', () => {
  it('matches the demo account: 41 added, 53 status updates, not 94', () => {
    const summary = summarizeFollowThrough(buildCells(demoPoints(), NOW, KL));

    expect(summary).toEqual({ added: DEMO_ADDED, updates: DEMO_UPDATES });
    expect(DEMO_RAW - DEMO_ADDED).toBe(DEMO_UPDATES);
  });

  it('counts only the twelve weeks the grid draws', () => {
    const cells = makeWeeksOfCells([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], '2026-07-13', [5]);

    expect(summarizeFollowThrough(cells)).toEqual({ added: 3, updates: 5 });
  });
});

describe('followThroughText', () => {
  it('states updates for every application added, to one decimal', () => {
    expect(followThroughText({ added: DEMO_ADDED, updates: DEMO_UPDATES })).toBe(
      '1.3 updates for every application added',
    );
  });

  it('is singular at exactly one', () => {
    expect(followThroughText({ added: 4, updates: 4 })).toBe(
      '1 update for every application added',
    );
  });

  it('says so rather than stating a ratio of nothing', () => {
    expect(followThroughText({ added: 0, updates: 0 })).toBe(
      'Nothing added or moved in these 12 weeks',
    );
    expect(followThroughText({ added: 0, updates: 6 })).toBe(
      'No applications added in these 12 weeks',
    );
    expect(followThroughText({ added: 5, updates: 0 })).toBe('No status updates yet');
  });
});

describe('FollowThrough', () => {
  it('shows the demo account’s 41 and 53 and never the raw 94', () => {
    render(<FollowThrough cells={buildCells(demoPoints(), NOW, KL)} />);

    expect(screen.getByText('Added').nextElementSibling).toHaveTextContent(/^41$/);
    expect(screen.getByText('Status updates').nextElementSibling).toHaveTextContent(/^53$/);
    expect(screen.getByText('1.3 updates for every application added')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/94|2\.3/);
  });
});

describe('TimelineChart status changes', () => {
  beforeEach(() => {
    installThemeTokens();
  });

  afterEach(() => {
    removeThemeTokens();
    resetClientState();
  });

  it('plots and reads out moves only, never the raw count', async () => {
    render(
      <TimelineChart
        timeline={makeTimeline({
          points: [makeTimelinePoint({ created: DEMO_ADDED, statusChanges: DEMO_RAW })],
        })}
        granularity="week"
        onGranularityChange={() => undefined}
        isLoading={false}
        error={null}
        onRetry={() => undefined}
      />,
    );

    expect(screen.getByText(`${String(DEMO_ADDED)} added, 53 status changes`)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(String(DEMO_RAW));

    await waitFor(() => {
      const canvas = document.querySelector('canvas');
      expect(canvas && Chart.getChart(canvas)?.data.datasets[1]?.data).toEqual([DEMO_UPDATES]);
    });
  });
});

describe('countActiveDays', () => {
  /** Twelve empty weeks from Monday 13 Jul; today is Friday 2 Oct, the 82nd day. */
  const TODAY = '2026-10-02';

  function cellsWith(days: Record<string, { count?: number; updates?: number }>): Cell[] {
    return makeWeeksOfCells(Array.from({ length: 12 }, () => 0)).map((cell) => ({
      ...cell,
      ...days[cell.key],
    }));
  }

  it('counts a day an application was added', () => {
    expect(countActiveDays(cellsWith({ '2026-09-01': { count: 2 } }), TODAY).active).toBe(1);
  });

  it('counts a day with status moves alone, which added-only counting misses', () => {
    expect(countActiveDays(cellsWith({ '2026-09-02': { updates: 3 } }), TODAY).active).toBe(1);
  });

  it('counts a day with both once', () => {
    expect(
      countActiveDays(cellsWith({ '2026-09-03': { count: 1, updates: 1 } }), TODAY).active,
    ).toBe(1);
  });

  it('does not count a day with neither', () => {
    expect(countActiveDays(cellsWith({}), TODAY)).toEqual({ active: 0, elapsed: 82 });
  });

  it('is out of the days so far, leaving the rest of this week out', () => {
    const days = cellsWith({ '2026-07-13': { count: 1 }, [TODAY]: { updates: 1 } });

    expect(countActiveDays(days, TODAY)).toEqual({ active: 2, elapsed: 82 });
    expect(countActiveDays(days, '2026-10-04')).toEqual({ active: 2, elapsed: 84 });
  });
});

describe('ActivityHeatmap shows Active days once, as the third figure', () => {
  const now = Date.now();
  const daysAgo = (days: number): string => new Date(now - days * 86_400_000).toISOString();

  function renderCard(): void {
    render(
      <ActivityHeatmap
        points={[
          // One added and two moves today; moves alone three days ago.
          makeTimelinePoint({ bucket: daysAgo(0), created: 1, statusChanges: 3 }),
          makeTimelinePoint({ bucket: daysAgo(3), created: 0, statusChanges: 2 }),
        ]}
        timeZone="UTC"
        weeklyGoal={5}
        isLoading={false}
      />,
    );
  }

  it('counts both days, the one with moves alone included', () => {
    renderCard();

    const label = screen.getByText('Active days');
    expect(label.nextElementSibling).toHaveTextContent(/^2$/);
    expect(label.nextElementSibling?.nextElementSibling).toHaveTextContent(
      /^of (7[89]|8[0-4]) days$/,
    );
  });

  it('renders one copy, third in the Added and Status updates row, hidden at no width', () => {
    renderCard();

    // The strip and its second copy are gone: no width-dependent placement.
    expect(screen.getAllByText('Active days')).toHaveLength(1);
    const row = screen.getByText('Added').closest('dl');
    if (!row) throw new Error('No figures row');
    const figures = [...row.children].map((figure) => figure.querySelector('dt')?.textContent);

    expect(figures).toEqual(['Added', 'Status updates', 'Active days']);
    expect(within(row).getByText('Active days').parentElement?.className).toBe('');
  });

  it('lays the row out in equal columns that never shrink below their content', () => {
    renderCard();

    // Spread across a wide column, unwrapped in a narrow one: the prototype's
    // `repeat(3, minmax(0, 1fr))` wrapped "Status updates" at a 240px column.
    expect(screen.getByText('Added').closest('dl')).toHaveClass(
      'grid',
      'grid-flow-col',
      'auto-cols-[minmax(max-content,1fr)]',
    );
  });
});

/*
  The heatmap shades a square by applications added plus status updates, the
  same count that makes an active day, so the shaded squares are the Active
  days figure. Added-only shading left a day of moves alone blank: 30 shaded
  squares beside 55 active days on the demo account. The zones and times are
  PR #70's, on both sides of the UTC date change for local Friday 2 Oct 2026.
*/
describe('the heatmap shades exactly the active days', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Squares painted above level 0, read off the class that colours them. */
  function shadedCells(): HTMLElement[] {
    return screen
      .getAllByTestId('heatmap-cell')
      .filter((cell) => !cell.classList.contains('bg-heat-0'));
  }

  function activeDaysShown(): number {
    return Number(screen.getByText('Active days').nextElementSibling?.textContent);
  }

  it.each([
    ['Asia/Kuala_Lumpur', '07:30 local, still 1 Oct in UTC', '2026-10-01T23:30:00.000Z', '+08:00'],
    ['Asia/Kuala_Lumpur', '23:59 local', '2026-10-02T15:59:00.000Z', '+08:00'],
    ['America/Los_Angeles', '01:00 local', '2026-10-02T08:00:00.000Z', '-07:00'],
    [
      'America/Los_Angeles',
      '22:30 local, already 3 Oct in UTC',
      '2026-10-03T05:30:00.000Z',
      '-07:00',
    ],
  ])('in %s at %s', (timeZone, _label, now, offset) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(now));
    const day = (key: string): string => new Date(`${key}T00:00:00${offset}`).toISOString();

    render(
      <ActivityHeatmap
        points={[
          // Added only: two openings, so no status updates.
          makeTimelinePoint({ bucket: day('2026-10-02'), created: 2, statusChanges: 2 }),
          // Moves alone, which added-only shading left blank.
          makeTimelinePoint({ bucket: day('2026-10-01'), created: 0, statusChanges: 3 }),
          makeTimelinePoint({ bucket: day('2026-08-03'), created: 0, statusChanges: 1 }),
          // Both on one day: one square, one active day.
          makeTimelinePoint({ bucket: day('2026-09-29'), created: 1, statusChanges: 4 }),
          // The week before the grid: neither.
          makeTimelinePoint({ bucket: day('2026-07-06'), created: 0, statusChanges: 5 }),
        ]}
        timeZone={timeZone}
        weeklyGoal={5}
        isLoading={false}
      />,
    );

    expect(activeDaysShown()).toBe(4);
    expect(shadedCells()).toHaveLength(4);
    expect(shadedCells().map((cell) => cell.title)).toEqual([
      '3 Aug 2026: 0 added, 1 status update',
      '29 Sep 2026: 1 added, 3 status updates',
      '1 Oct 2026: 0 added, 3 status updates',
      '2 Oct 2026: 2 added, 0 status updates',
    ]);
    expect(
      screen.getByRole('img', {
        name: 'Activity heatmap: 3 applications added and 7 status updates, on 4 active days in the last 12 weeks',
      }),
    ).toBeInTheDocument();
  });

  it('shades the busiest day of moves alone at the top level', () => {
    render(
      <ActivityHeatmap
        points={[
          makeTimelinePoint({ bucket: new Date().toISOString(), created: 0, statusChanges: 6 }),
        ]}
        timeZone="UTC"
        weeklyGoal={5}
        isLoading={false}
      />,
    );

    expect(shadedCells()).toHaveLength(1);
    expect(shadedCells()[0]).toHaveClass('bg-heat-4');
  });
});
