import type { SelectOption } from '@/components/ui/Select';

/**
 * A short, sensible list rather than all ~400 IANA zones in a native select.
 *
 * `Intl.supportedValuesOf` is not available in every browser the app targets and
 * returns far too many options to scroll on a phone, so this is a curated set
 * covering the regions the app is used from. The account's own zone is always
 * merged in, so a value set at registration or edited elsewhere is never
 * silently dropped just because it is not on this list.
 *
 * Each zone carries the place a person would recognise it by: "Asia/Shanghai"
 * alone does not tell anyone it is China's time.
 */
const COMMON_ZONES: Record<string, string> = {
  'Asia/Kuala_Lumpur': 'Kuala Lumpur, Malaysia',
  'Asia/Singapore': 'Singapore',
  'Asia/Jakarta': 'Jakarta, Indonesia',
  'Asia/Bangkok': 'Bangkok, Thailand',
  'Asia/Manila': 'Manila, Philippines',
  'Asia/Ho_Chi_Minh': 'Ho Chi Minh City, Vietnam',
  'Asia/Hong_Kong': 'Hong Kong',
  'Asia/Tokyo': 'Tokyo, Japan',
  'Asia/Seoul': 'Seoul, South Korea',
  'Asia/Shanghai': 'Beijing, Shanghai, China',
  'Asia/Kolkata': 'India',
  'Asia/Dubai': 'Dubai, United Arab Emirates',
  'Australia/Sydney': 'Sydney, Australia',
  'Australia/Perth': 'Perth, Australia',
  'Pacific/Auckland': 'Auckland, New Zealand',
  'Europe/London': 'London, United Kingdom',
  'Europe/Dublin': 'Dublin, Ireland',
  'Europe/Paris': 'Paris, France',
  'Europe/Berlin': 'Berlin, Germany',
  'Europe/Amsterdam': 'Amsterdam, Netherlands',
  'Europe/Madrid': 'Madrid, Spain',
  'Europe/Stockholm': 'Stockholm, Sweden',
  'Europe/Warsaw': 'Warsaw, Poland',
  'Europe/Istanbul': 'Istanbul, Türkiye',
  'Africa/Lagos': 'Lagos, Nigeria',
  'Africa/Nairobi': 'Nairobi, Kenya',
  'Africa/Johannesburg': 'Johannesburg, South Africa',
  'America/Sao_Paulo': 'São Paulo, Brazil',
  'America/New_York': 'New York, US Eastern',
  'America/Toronto': 'Toronto, Canada',
  'America/Chicago': 'Chicago, US Central',
  'America/Denver': 'Denver, US Mountain',
  'America/Los_Angeles': 'Los Angeles, US Pacific',
  'America/Vancouver': 'Vancouver, Canada',
  UTC: 'Coordinated Universal Time',
};

/**
 * The zone's offset from UTC right now, as minutes and as "UTC+08:00".
 * Read at call time, so a zone observing daylight saving shows today's offset.
 */
function currentOffset(zone: string, now: Date): { minutes: number; text: string } {
  try {
    const name =
      new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
        .formatToParts(now)
        .find((part) => part.type === 'timeZoneName')?.value ?? '';
    // "GMT+08:00", "GMT-03:30", or a bare "GMT" for UTC itself in some engines.
    const match = /([+-])(\d{2}):(\d{2})/.exec(name);
    if (!match) return { minutes: 0, text: 'UTC+00:00' };
    const [, sign, hours, mins] = match;
    const minutes = (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(mins));
    return { minutes, text: `UTC${sign}${hours}:${mins}` };
  } catch {
    return { minutes: 0, text: 'UTC+00:00' };
  }
}

/** "Asia/Kuala_Lumpur" → "Kuala Lumpur, Malaysia"; unlisted zones fall back to the city. */
function place(zone: string): string {
  return COMMON_ZONES[zone] ?? (zone.split('/').pop() ?? zone).split('_').join(' ');
}

/** "(UTC+08:00) Kuala Lumpur, Malaysia" — the label shown for `zone` anywhere in settings. */
export function timezoneLabel(zone: string, now: Date = new Date()): string {
  return `(${currentOffset(zone, now).text}) ${place(zone)}`;
}

/** The zone list, with `current` guaranteed present, ordered west to east by offset. */
export function timezoneOptions(current: string, now: Date = new Date()): SelectOption[] {
  const zones = new Set<string>(Object.keys(COMMON_ZONES));
  if (current) zones.add(current);

  return [...zones]
    .map((zone) => ({
      zone,
      offset: currentOffset(zone, now).minutes,
      label: timezoneLabel(zone, now),
    }))
    .sort((a, b) => a.offset - b.offset || a.label.localeCompare(b.label))
    .map(({ zone, label }) => ({ value: zone, label }));
}

/** The browser's own guess, offered as a one-click fix when the account drifts. */
export function detectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}
