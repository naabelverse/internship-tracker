import { describe, expect, it } from 'vitest';
import { timezoneLabel, timezoneOptions } from '@/features/settings/timezoneOptions';

/**
 * The timezone picker names each zone by its offset and the place people know it
 * by, so "Asia/Shanghai" reads as China and New York's offset follows DST.
 */
describe('timezone options', () => {
  const july = new Date('2026-07-01T12:00:00Z');
  const january = new Date('2026-01-15T12:00:00Z');

  it('labels a zone with its UTC offset and country', () => {
    expect(timezoneLabel('Asia/Kuala_Lumpur', july)).toBe('(UTC+08:00) Kuala Lumpur, Malaysia');
    expect(timezoneLabel('Asia/Kolkata', july)).toBe('(UTC+05:30) India');
    expect(timezoneLabel('UTC', july)).toBe('(UTC+00:00) Coordinated Universal Time');
  });

  it("shows today's offset for a zone observing daylight saving", () => {
    expect(timezoneLabel('America/New_York', july)).toBe('(UTC-04:00) New York, US Eastern');
    expect(timezoneLabel('America/New_York', january)).toBe('(UTC-05:00) New York, US Eastern');
  });

  it('orders zones west to east', () => {
    const values = timezoneOptions('Asia/Kuala_Lumpur', july).map((option) => option.value);
    expect(values.indexOf('America/Los_Angeles')).toBeLessThan(values.indexOf('UTC'));
    expect(values.indexOf('UTC')).toBeLessThan(values.indexOf('Asia/Kuala_Lumpur'));
    expect(values.indexOf('Asia/Kuala_Lumpur')).toBeLessThan(values.indexOf('Pacific/Auckland'));
  });
});
