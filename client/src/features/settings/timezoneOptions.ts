import type { SelectOption } from '@/components/ui/Select';

/**
 * A short, sensible list rather than all ~400 IANA zones in a native select.
 *
 * `Intl.supportedValuesOf` is not available in every browser the app targets and
 * returns far too many options to scroll on a phone, so this is a curated set
 * covering the regions the app is used from. The account's own zone is always
 * merged in, so a value set at registration or edited elsewhere is never
 * silently dropped just because it is not on this list.
 */
const COMMON_ZONES = [
  'Asia/Kuala_Lumpur',
  'Asia/Singapore',
  'Asia/Jakarta',
  'Asia/Bangkok',
  'Asia/Manila',
  'Asia/Ho_Chi_Minh',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Australia/Sydney',
  'Australia/Perth',
  'Pacific/Auckland',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Madrid',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Istanbul',
  'Africa/Lagos',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  'America/Sao_Paulo',
  'America/New_York',
  'America/Toronto',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Vancouver',
  'UTC',
] as const;

/** "Asia/Kuala_Lumpur" reads better as "Asia / Kuala Lumpur". */
function label(zone: string): string {
  return zone.split('/').join(' / ').split('_').join(' ');
}

/** The zone list, with `current` guaranteed present and the whole set sorted. */
export function timezoneOptions(current: string): SelectOption[] {
  const zones = new Set<string>(COMMON_ZONES);
  if (current) zones.add(current);

  return [...zones].sort().map((zone) => ({ value: zone, label: label(zone) }));
}

/** The browser's own guess, offered as a one-click fix when the account drifts. */
export function detectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}
