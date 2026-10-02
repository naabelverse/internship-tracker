import type { Cell } from '@/features/dashboard/heatmapCells';

const DAYS_PER_WEEK = 7;

export interface WeekTotal {
  /** The week's Monday in the account's zone, `YYYY-MM-DD`. */
  start: string;
  count: number;
}

export interface PaceSummary {
  weeks: number;
  /** Weeks that reached the goal; null with a goal of 0, which every week meets. */
  metWeeks: number | null;
  /** Applications added per week, across every week shown. */
  average: number;
}

const averageFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

/**
 * The heatmap's cells, summed a column at a time. `buildCells` lays them out
 * Monday first in runs of seven, so each run is one of the grid's week columns
 * and the last is the week in progress. The weekly goal counts applications
 * created since the same local Monday, so that bar matches the goal stat card.
 */
export function weeklyTotals(cells: Cell[]): WeekTotal[] {
  return cells
    .filter((_cell, index) => index % DAYS_PER_WEEK === 0)
    .map((monday, week) => ({
      start: monday.key,
      count: cells
        .slice(week * DAYS_PER_WEEK, (week + 1) * DAYS_PER_WEEK)
        .reduce((sum, cell) => sum + cell.count, 0),
    }));
}

/**
 * How many weeks met the goal, and the mean per week. Both span every week the
 * grid shows, the one in progress included, so "of 12" and "a week" describe
 * the same twelve columns the reader is looking at.
 */
export function summarizePace(totals: WeekTotal[], target: number): PaceSummary {
  const total = totals.reduce((sum, week) => sum + week.count, 0);

  return {
    weeks: totals.length,
    metWeeks: target > 0 ? totals.filter((week) => week.count >= target).length : null,
    average: totals.length === 0 ? 0 : total / totals.length,
  };
}

export function paceSummaryText({ weeks, metWeeks, average }: PaceSummary): string {
  const goal =
    metWeeks === null
      ? 'No weekly goal set'
      : `Goal met in ${String(metWeeks)} of ${String(weeks)} weeks`;

  return `${goal} · ${averageFormat.format(average)} a week on average`;
}

/**
 * The count the top of the plot stands for: the busiest week, or the goal if
 * no week has reached it yet, so the goal line never falls off the top.
 */
export function paceScale(totals: WeekTotal[], target: number): number {
  return totals.reduce((max, week) => Math.max(max, week.count), Math.max(target, 1));
}

/** A bar's height as a percentage of the plot. */
export function barPercent(count: number, scale: number): number {
  return (count / scale) * 100;
}

/** Where the goal line sits, as a percentage of the plot from the bottom. */
export function goalLinePercent(totals: WeekTotal[], target: number): number {
  return barPercent(target, paceScale(totals, target));
}
