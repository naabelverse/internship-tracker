import { format } from 'date-fns';
import { MAX_DATE_YEAR, MIN_DATE_YEAR } from '@/types/application';

/** `min` and `max` for a date input and a datetime-local input, respectively. */
export const DATE_INPUT_BOUNDS = {
  date: { min: `${String(MIN_DATE_YEAR)}-01-01`, max: `${String(MAX_DATE_YEAR)}-12-31` },
  dateTime: {
    min: `${String(MIN_DATE_YEAR)}-01-01T00:00`,
    max: `${String(MAX_DATE_YEAR)}-12-31T23:59`,
  },
} as const;

export const DATE_RANGE_MESSAGE = `Enter a date between ${String(MIN_DATE_YEAR)} and ${String(MAX_DATE_YEAR)}`;

const INPUT_VALUE = /^(\d{4,6})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)?$/;

/**
 * Whether a date or datetime-local input's value is empty or a real day inside
 * the allowed years. `min` and `max` only mark the input invalid: its `value`
 * still reports whatever was typed or pasted, including `111111-11-11`, so this
 * is the check that actually holds the line on the client.
 */
export function isDateInputInRange(value: string): boolean {
  if (value === '') return true;

  const match = INPUT_VALUE.exec(value);
  if (!match) return false;

  const [year, month, day] = match.slice(1, 4).map(Number) as [number, number, number];
  if (year < MIN_DATE_YEAR || year > MAX_DATE_YEAR) return false;

  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** The first and last days the calendar can show or pick, in local time. */
export const CALENDAR_BOUNDS = {
  first: new Date(MIN_DATE_YEAR, 0, 1),
  last: new Date(MAX_DATE_YEAR, 11, 31),
} as const;

/** The time a datetime-local field starts at when its day is picked before any time is entered. */
export const DEFAULT_PICKED_TIME = '09:00';

/**
 * The day a date or datetime-local value names, as local midnight, or
 * `undefined` when the value is empty or would be refused by
 * `isDateInputInRange`, so the calendar never marks a day the form rejects.
 */
export function dayFromInputValue(value: string): Date | undefined {
  if (value === '' || !isDateInputInRange(value)) return undefined;

  const [year, month, day] = value.slice(0, 10).split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

/**
 * The value a field takes when `day` is picked from the calendar. A
 * datetime-local field keeps the time it already holds, so moving an interview
 * to another day never moves its hour.
 */
export function inputValueForDay(day: Date, withTime: boolean, previous: string): string {
  const date = format(day, 'yyyy-MM-dd');
  if (!withTime) return date;

  const time = /T(\d{2}:\d{2})/.exec(previous)?.[1] ?? DEFAULT_PICKED_TIME;
  return `${date}T${time}`;
}
