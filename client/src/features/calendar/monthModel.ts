import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parse,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { CalendarEvent } from '@/types/calendar';

/** SPEC section 6: deadlines red, interviews blue. Theme tokens, never literals. */
export const EVENT_TONE = {
  deadline: 'bg-danger/15 text-danger',
  interview: 'bg-info/15 text-info',
} as const;

/** Weeks start on Monday, which is how a job hunt week reads. */
const WEEK_OPTIONS = { weekStartsOn: 1 } as const;

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

/**
 * The window the grid actually shows, which is wider than the month: the leading
 * and trailing cells belong to the neighbouring months and their events have to
 * be fetched too, or those cells would look empty when they are not.
 */
export function monthRange(month: Date): { from: string; to: string } {
  return {
    from: startOfWeek(startOfMonth(month), WEEK_OPTIONS).toISOString(),
    to: endOfWeek(endOfMonth(month), WEEK_OPTIONS).toISOString(),
  };
}

export function buildMonthGrid(
  month: Date,
  events: CalendarEvent[],
  now = new Date(),
): CalendarDay[] {
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), WEEK_OPTIONS),
    end: endOfWeek(endOfMonth(month), WEEK_OPTIONS),
  });

  return days.map((date) => ({
    date,
    inMonth: isSameMonth(date, month),
    isToday: isSameDay(date, now),
    events: events.filter((event) => isSameDay(new Date(event.at), date)),
  }));
}
