import { statusUpdates } from '@/features/dashboard/statusUpdates';
import type { TimelinePoint } from '@/types/analytics';

/** The grid's length, which SPEC section 6 fixes at the last twelve weeks. */
const WEEKS = 12;
const DAYS_PER_WEEK = 7;
const MS_PER_DAY = 86_400_000;

export interface Cell {
  /** The user's local calendar date, `YYYY-MM-DD`. */
  key: string;
  /** Applications added that day. */
  count: number;
  /** Status changes to existing applications that day; see `statusUpdates`. */
  updates: number;
}

/**
 * The calendar date an instant falls on in `timeZone`, as `YYYY-MM-DD`.
 *
 * The analytics pipeline buckets on the user's local midnight and sends that
 * as a UTC instant, so local 2 Oct in Kuala Lumpur arrives as
 * `2026-10-01T16:00:00Z`. Its first ten characters name the wrong day for any
 * zone east of UTC; only reading it back in the same zone names the right one.
 */
export function localDayKey(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * Steps a date key by whole days. Date-only arithmetic at UTC midnight, so a
 * daylight saving change in the user's zone cannot skip or repeat a day.
 */
function shiftDayKey(key: string, days: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Monday 0 to Sunday 6, matching the week the analytics aggregation buckets on. */
function weekdayIndex(key: string): number {
  return (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % DAYS_PER_WEEK;
}

/**
 * The last twelve weeks of the user's local days, ending on the week that
 * holds `now`, Monday-aligned, with each bucket's applications and status
 * updates on the day it names in `timeZone`. The browser's own zone plays no part in it.
 */
export function buildCells(points: TimelinePoint[], now: Date, timeZone: string): Cell[] {
  const counts = new Map<string, number>();
  const updates = new Map<string, number>();

  for (const point of points) {
    const key = localDayKey(new Date(point.bucket), timeZone);
    counts.set(key, (counts.get(key) ?? 0) + point.created);
    updates.set(key, (updates.get(key) ?? 0) + statusUpdates(point));
  }

  // Monday of the current week, then back eleven more weeks, so the grid always
  // ends on a whole week and today never lands mid-column.
  const today = localDayKey(now, timeZone);
  const start = shiftDayKey(today, -(weekdayIndex(today) + (WEEKS - 1) * DAYS_PER_WEEK));

  return Array.from({ length: WEEKS * DAYS_PER_WEEK }, (_unused, index) => {
    const key = shiftDayKey(start, index);

    return { key, count: counts.get(key) ?? 0, updates: updates.get(key) ?? 0 };
  });
}
