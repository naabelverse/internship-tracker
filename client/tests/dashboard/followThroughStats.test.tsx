import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FollowThrough } from '@/features/dashboard/FollowThrough';
import { TimelineChart } from '@/features/dashboard/charts/TimelineChart';
import { Chart } from '@/features/dashboard/charts/chartRegistry';
import { followThroughText, summarizeFollowThrough } from '@/features/dashboard/followThroughStats';
import { buildCells } from '@/features/dashboard/heatmapCells';
import { statusUpdates } from '@/features/dashboard/statusUpdates';
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
