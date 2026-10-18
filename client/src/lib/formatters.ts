import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';
import type { Stipend } from '@/types/application';

const MS_PER_DAY = 86_400_000;

/** Parses an API timestamp, returning null rather than an Invalid Date. */
export function toDate(value: string | undefined | null): Date | null {
  if (!value) return null;

  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

/**
 * Whether a stored deadline is a date with no time. The form, a date-only CSV
 * cell and a date-only API value all store the day at exactly 00:00:00.000 UTC,
 * so that instant is read as "no time". The trade-off: a deadline genuinely set
 * for 00:00:00.000 UTC is indistinguishable from one, and loses its time too.
 */
export function isDateOnly(value: string): boolean {
  const date = toDate(value);
  return date !== null && date.getTime() % MS_PER_DAY === 0;
}

/**
 * Reads a value as the day a person means. A date-only value becomes local
 * midnight of the calendar date it names: converting the instant instead puts it
 * on the previous day anywhere west of UTC (issue #99). Any other value is
 * returned as its instant.
 */
function toCalendarDate(value: string | undefined | null): Date | null {
  const date = toDate(value);
  if (date === null || date.getTime() % MS_PER_DAY !== 0) return date;

  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function formatDate(value: string | undefined | null, fallback = '—'): string {
  const date = toCalendarDate(value);
  return date ? format(date, 'd MMM yyyy') : fallback;
}

export function formatDateTime(value: string | undefined | null, fallback = '—'): string {
  const date = toDate(value);
  return date ? format(date, 'd MMM yyyy, HH:mm') : fallback;
}

/** `21:20`: the time half of `formatDateTime`, in the same timezone. `HH` runs 00 to 23, never 24. */
export function formatTime(value: string | undefined | null, fallback = '—'): string {
  const date = toDate(value);
  return date ? format(date, 'HH:mm') : fallback;
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

/** `formatDate`'s `11 Feb 2026`, read in `timeZone` rather than the browser's zone. */
export function formatDateIn(value: string, timeZone: string): string {
  const date = toDate(value);
  return date
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone,
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(date)
    : '—';
}

/** `formatTime`'s `21:20`, read in `timeZone` rather than the browser's zone. */
export function formatTimeIn(value: string, timeZone: string): string {
  const date = toDate(value);
  return date
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(date)
    : '—';
}

/** "in 3 days" / "2 days ago", as SPEC section 6 asks for on deadlines. */
export function formatRelative(value: string | undefined | null, fallback = '—'): string {
  const date = toCalendarDate(value);
  return date ? formatDistanceToNowStrict(date, { addSuffix: true }) : fallback;
}

/** Whole days from today to `value`; negative once the date has passed. */
export function daysUntil(value: string | undefined | null, now = new Date()): number | null {
  const date = toCalendarDate(value);
  if (!date) return null;

  const startOfDay = (input: Date): number =>
    new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime();

  return Math.round((startOfDay(date) - startOfDay(now)) / MS_PER_DAY);
}

export function formatStipend(stipend: Stipend | undefined): string {
  if (!stipend) return '—';

  const amount = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: stipend.currency,
    maximumFractionDigits: 0,
  }).format(stipend.amount);

  return `${amount} / ${stipend.period}`;
}

const FILE_UNITS = ['B', 'KB', 'MB'] as const;

export function formatFileSize(bytes: number): string {
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < FILE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(unit === 0 ? 0 : 1)} ${FILE_UNITS[unit]}`;
}

/** Initials for the logo fallback SPEC section 4 describes. */
export function companyInitials(company: string): string {
  return company
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}
