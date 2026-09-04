/**
 * Timezone helpers. Every stored timestamp is UTC; these turn a UTC instant into
 * what the clock on a given user wall reads, which is what SPEC section 7
 * requires for days, weeks, streaks and reminder delivery.
 *
 * All conversions go through Intl, the authoritative tzdata implementation, so
 * daylight saving transitions are handled rather than approximated by an offset.
 */

export const DEFAULT_TIME_ZONE = 'UTC';

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function partsFor(instant: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { timeZone, ...options }).formatToParts(instant);
}

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? '';
}

/** Hour of the local clock, 0 to 23, at this instant in the given zone. */
export function localHour(instant: Date, timeZone: string): number {
  const parts = partsFor(instant, timeZone, { hour: '2-digit', hourCycle: 'h23' });
  return Number(partValue(parts, 'hour'));
}

/** The local calendar day as `YYYY-MM-DD`, the key every day-bucketed metric uses. */
export function localDayKey(instant: Date, timeZone: string): string {
  const parts = partsFor(instant, timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return `${partValue(parts, 'year')}-${partValue(parts, 'month')}-${partValue(parts, 'day')}`;
}

/** The calendar day before a `YYYY-MM-DD` key, used to walk a streak backwards. */
export function previousDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);

  return date.toISOString().slice(0, 10);
}

/**
 * A due time as the recipient's own clock shows it, e.g. `Fri 11 Sep, 09:00`.
 *
 * Emails are the one place a stored UTC instant is read by a person rather than
 * by a query, so the formatting happens here, once, against their zone — never
 * in a template, which has no zone to format against.
 */
export function localDateTimeLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

/** A calendar day without the time, e.g. `11 Sep`. Used for week ranges. */
export function localDateLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
  }).format(instant);
}

/** ISO weekday in the given zone, 1 for Monday through 7 for Sunday. */
export function localWeekday(instant: Date, timeZone: string): number {
  const parts = partsFor(instant, timeZone, { weekday: 'short' });
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return names.indexOf(partValue(parts, 'weekday')) + 1;
}

/**
 * The UTC instant at which the current local week began, taking Monday as the
 * first day. Used for the weekly goal window, which has to reset on the user
 * Monday rather than the server one.
 */
export function startOfLocalWeek(instant: Date, timeZone: string): Date {
  const weekday = localWeekday(instant, timeZone);
  const dayKey = localDayKey(instant, timeZone);

  let cursor = dayKey;
  for (let step = 1; step < weekday; step += 1) {
    cursor = previousDayKey(cursor);
  }

  return startOfLocalDay(cursor, timeZone);
}

/**
 * The UTC instant at which a local calendar day begins. Solved by probing rather
 * than by adding an offset, because the offset itself depends on the date.
 */
export function startOfLocalDay(dayKey: string, timeZone: string): Date {
  const [year, month, day] = dayKey.split('-').map(Number);

  // Midnight UTC on that date is at most one day away from the real answer, so
  // two correction passes converge for every zone including the half-hour ones.
  let guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

  for (let pass = 0; pass < 2; pass += 1) {
    const parts = partsFor(guess, timeZone, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });

    const offsetMinutes =
      Number(partValue(parts, 'hour')) * 60 + Number(partValue(parts, 'minute'));
    const dayDelta =
      Date.UTC(
        Number(partValue(parts, 'year')),
        Number(partValue(parts, 'month')) - 1,
        Number(partValue(parts, 'day')),
      ) - Date.UTC(year, month - 1, day);

    guess = new Date(guess.getTime() - dayDelta - offsetMinutes * 60_000);
  }

  return guess;
}
