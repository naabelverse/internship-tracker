import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parse,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { isDateOnly, localDayKey } from '@/lib/formatters';
import type { CalendarEvent } from '@/types/calendar';

/** SPEC section 6: deadlines red, interviews blue. Theme tokens, never literals. */
export const EVENT_TONE = {
  deadline: 'bg-danger/15 text-danger',
  interview: 'bg-info/15 text-info',
} as const;

/** Weeks start on Monday, which is how a job hunt week reads. */
const WEEK_OPTIONS = { weekStartsOn: 1 } as const;

/**
 * How far the fetch window reaches past the grid. The grid's days are read in
 * the account's zone, which can sit up to 26 hours from the browser's (UTC+14 to
 * UTC-12), so a window cut at the browser's midnights would miss edge events.
 */
const WINDOW_MARGIN_DAYS = 2;

export const MONTH_PARAM = 'month';
export const MONTH_FORMAT = 'yyyy-MM';

export interface CalendarDay {
  date: Date;
  /** False for the leading and trailing days borrowed from adjacent months. */
  inMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
}

/** Parses `?month=2026-02`, falling back to the current month for anything else. */
export function parseMonth(raw: string | null, now = new Date()): Date {
  if (raw === null) return startOfMonth(now);

  const parsed = parse(raw, MONTH_FORMAT, now);
  return Number.isNaN(parsed.getTime()) ? startOfMonth(now) : startOfMonth(parsed);
}

export function formatMonthParam(month: Date): string {
  return format(month, MONTH_FORMAT);
}

export function shiftMonth(month: Date, step: number): Date {
  return addMonths(month, step);
}

/** The `YYYY-MM-DD` a grid cell names. Cells are plain calendar days, not instants. */
export function gridDayKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * The day an event belongs under. A date-only deadline names its date outright,
 * in every zone (issue #99); anything with a time falls on the day it is in the
 * account's zone, as the reminder emails and the heatmap read it (issue #98).
 */
export function eventDayKey(event: Pick<CalendarEvent, 'kind' | 'at'>, timeZone: string): string {
  const instant = new Date(event.at);

  return event.kind === 'deadline' && isDateOnly(event.at)
    ? instant.toISOString().slice(0, 10)
    : localDayKey(instant, timeZone);
}

/**
 * The window to fetch: wider than the month, because the leading and trailing
 * cells belong to the neighbouring months and their events have to be fetched
 * too, and wider again by `WINDOW_MARGIN_DAYS` for the zone difference.
 */
export function monthRange(month: Date): { from: string; to: string } {
  return {
    from: addDays(
      startOfWeek(startOfMonth(month), WEEK_OPTIONS),
      -WINDOW_MARGIN_DAYS,
    ).toISOString(),
    to: addDays(endOfWeek(endOfMonth(month), WEEK_OPTIONS), WINDOW_MARGIN_DAYS).toISOString(),
  };
}

export function buildMonthGrid(
  month: Date,
  events: CalendarEvent[],
  timeZone: string,
  now = new Date(),
): CalendarDay[] {
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), WEEK_OPTIONS),
    end: endOfWeek(endOfMonth(month), WEEK_OPTIONS),
  });
  const today = localDayKey(now, timeZone);

  return days.map((date) => {
    const key = gridDayKey(date);

    return {
      date,
      inMonth: isSameMonth(date, month),
      isToday: key === today,
      events: events.filter((event) => eventDayKey(event, timeZone) === key),
    };
  });
}
