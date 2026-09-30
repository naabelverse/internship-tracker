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
