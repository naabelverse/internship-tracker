import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WeeklyPace } from '@/features/dashboard/WeeklyPace';
import {
  goalLinePercent,
  paceSummaryText,
  summarizePace,
  weeklyTotals,
} from '@/features/dashboard/paceWeeks';
import { makeWeeksOfCells } from '../utils/factories';

/*
  The pace panel reads the heatmap's own 84 cells, so its twelve bars are the
  grid's twelve columns summed, and "this week" is the same number the weekly
  goal stat card shows: both count applications created since the account's
  local Monday.
*/

/** Six of the twelve reach a goal of 5, one of them exactly on it. 64 in all. */
const WEEKS = [3, 7, 0, 5, 9, 2, 4, 6, 1, 8, 4, 15];
const TOTAL = 64;

function bars(): HTMLElement[] {
  return screen.getAllByTestId('pace-bar');
}

/** The bar's painted share of the plot, from the style the browser lays out. */
function heightPercent(element: HTMLElement): number {
  return parseFloat(element.style.height);
}

describe('weeklyTotals', () => {
  it('sums each run of seven cells into one week, oldest first', () => {
    const totals = weeklyTotals(makeWeeksOfCells(WEEKS));

    expect(totals.map((week) => week.count)).toEqual(WEEKS);
    expect(totals[0]?.start).toBe('2026-07-13');
    expect(totals[11]?.start).toBe('2026-09-28');
  });
});

describe('summarizePace', () => {
  it('counts a week that lands exactly on the goal as met', () => {
    const summary = summarizePace(weeklyTotals(makeWeeksOfCells(WEEKS)), 5);

    // 7, 5, 9, 6, 8 and 15 reach 5; the 5 is the boundary case.
    expect(summary.metWeeks).toBe(6);
    expect(summary.weeks).toBe(12);
  });

  it('averages over all twelve weeks, empty ones included', () => {
    const summary = summarizePace(weeklyTotals(makeWeeksOfCells(WEEKS)), 5);

    expect(summary.average).toBeCloseTo(TOTAL / 12, 9);
  });

  it('has no weeks met when there is no goal to meet', () => {
    expect(summarizePace(weeklyTotals(makeWeeksOfCells(WEEKS)), 0).metWeeks).toBeNull();
  });
});

describe('paceSummaryText', () => {
  it.each([
    [WEEKS, 5, 'Goal met in 6 of 12 weeks · 5.3 a week on average'],
    [WEEKS, 10, 'Goal met in 1 of 12 weeks · 5.3 a week on average'],
    [Array<number>(12).fill(5), 5, 'Goal met in 12 of 12 weeks · 5 a week on average'],
    [Array<number>(12).fill(0), 5, 'Goal met in 0 of 12 weeks · 0 a week on average'],
    [WEEKS, 0, 'No weekly goal set · 5.3 a week on average'],
  ])('reads %j against a goal of %i as "%s"', (weeks, target, text) => {
    expect(paceSummaryText(summarizePace(weeklyTotals(makeWeeksOfCells(weeks)), target))).toBe(
      text,
    );
  });
});

describe('goalLinePercent', () => {
  it('puts the goal at its share of the busiest week', () => {
    expect(goalLinePercent(weeklyTotals(makeWeeksOfCells(WEEKS)), 5)).toBeCloseTo(100 / 3, 9);
  });

  it('tops the plot when the goal is above every week', () => {
    expect(goalLinePercent(weeklyTotals(makeWeeksOfCells([1, 2, 3])), 6)).toBe(100);
  });
});

describe('WeeklyPace', () => {
  it('draws one bar per week, each sized to its own total', () => {
    render(<WeeklyPace cells={makeWeeksOfCells(WEEKS)} target={5} />);

    expect(bars()).toHaveLength(12);
    expect(bars().map((bar) => Number(bar.dataset.count))).toEqual(WEEKS);
    // The busiest week, 15, fills the plot; everything else is its share of it.
    WEEKS.forEach((count, index) => {
      expect(heightPercent(bars()[index] as HTMLElement)).toBeCloseTo((count / 15) * 100, 9);
    });
  });

  it('draws the goal line where a week of exactly the goal would reach', () => {
    render(<WeeklyPace cells={makeWeeksOfCells(WEEKS)} target={5} />);

    const line = screen.getByTestId('pace-goal');
    const onGoal = bars()[3] as HTMLElement;

    expect(onGoal.dataset.count).toBe('5');
    expect(parseFloat(line.style.bottom)).toBeCloseTo(heightPercent(onGoal), 9);
  });

  it('keeps the goal line inside the plot when no week reaches it', () => {
    render(
      <WeeklyPace cells={makeWeeksOfCells([1, 0, 2, 0, 1, 0, 0, 3, 0, 0, 1, 0])} target={5} />,
    );

    expect(parseFloat(screen.getByTestId('pace-goal').style.bottom)).toBe(100);
    expect(heightPercent(bars()[7] as HTMLElement)).toBeCloseTo(60, 9);
  });

  it('states the summary in words', () => {
    render(<WeeklyPace cells={makeWeeksOfCells(WEEKS)} target={5} />);

    expect(
      screen.getByText('Goal met in 6 of 12 weeks · 5.3 a week on average'),
    ).toBeInTheDocument();
  });

  it('gives a reader every weekly total and the goal, not twelve bare bars', () => {
    render(<WeeklyPace cells={makeWeeksOfCells(WEEKS)} target={5} />);

    expect(
      screen.getByRole('img', {
        name: `Applications added per week, oldest first: ${WEEKS.join(', ')}. Weekly goal: 5.`,
      }),
    ).toBeInTheDocument();
  });

  it('draws no goal line for an account with no goal set', () => {
    render(<WeeklyPace cells={makeWeeksOfCells(WEEKS)} target={0} />);

    expect(screen.queryByTestId('pace-goal')).not.toBeInTheDocument();
    expect(screen.getByText('No weekly goal set · 5.3 a week on average')).toBeInTheDocument();
  });

  it('labels the current week as still in progress', () => {
    render(<WeeklyPace cells={makeWeeksOfCells(WEEKS)} target={5} />);

    const plot = screen.getByRole('img');
    const last = within(plot).getAllByTestId('pace-bar').at(-1) as HTMLElement;

    expect(last).toHaveAttribute('title', 'This week so far: 15 added');
    expect(bars()[0]).toHaveAttribute('title', 'Week of 13 Jul 2026: 3 added');
  });
});
