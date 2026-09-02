import {
  isValidTimeZone,
  localDayKey,
  localHour,
  localWeekday,
  previousDayKey,
  startOfLocalDay,
  startOfLocalWeek,
} from '@/utils/dates';

const KL = 'Asia/Kuala_Lumpur';
const LA = 'America/Los_Angeles';

describe('timezone helpers', () => {
  describe('localHour', () => {
    it('reads the wall clock in each zone for the same instant', () => {
      // 2026-03-10 is inside US daylight saving, which began on Sunday 8 March.
      const instant = new Date('2026-03-10T00:00:00Z');

      expect(localHour(instant, KL)).toBe(8);
      expect(localHour(instant, LA)).toBe(17);
      expect(localHour(instant, 'UTC')).toBe(0);
    });

    it('follows a daylight saving change rather than a fixed offset', () => {
      const beforeDst = new Date('2026-03-01T16:00:00Z');
      const afterDst = new Date('2026-03-15T16:00:00Z');

      expect(localHour(beforeDst, LA)).toBe(8);
      expect(localHour(afterDst, LA)).toBe(9);
    });
  });

  describe('localDayKey', () => {
    it('places one instant on different calendar days in distant zones', () => {
      const instant = new Date('2026-03-10T02:00:00Z');

      expect(localDayKey(instant, KL)).toBe('2026-03-10');
      expect(localDayKey(instant, LA)).toBe('2026-03-09');
    });

    it('handles an instant on either side of local midnight', () => {
      expect(localDayKey(new Date('2026-03-09T15:59:00Z'), KL)).toBe('2026-03-09');
      expect(localDayKey(new Date('2026-03-09T16:00:00Z'), KL)).toBe('2026-03-10');
    });
  });

  describe('previousDayKey', () => {
    it.each([
      ['2026-03-10', '2026-03-09'],
      ['2026-03-01', '2026-02-28'],
      ['2026-01-01', '2025-12-31'],
      ['2024-03-01', '2024-02-29'],
    ])('maps %s to %s', (input, expected) => {
      expect(previousDayKey(input)).toBe(expected);
    });
  });

  describe('localWeekday', () => {
    it('returns ISO weekdays, and can differ across zones for one instant', () => {
      const instant = new Date('2026-03-10T02:00:00Z');

      expect(localWeekday(instant, KL)).toBe(2);
      expect(localWeekday(instant, LA)).toBe(1);
    });
  });

  describe('startOfLocalDay', () => {
    it.each([
      ['2026-03-10', KL, '2026-03-09T16:00:00.000Z'],
      ['2026-03-10', LA, '2026-03-10T07:00:00.000Z'],
      ['2026-03-05', LA, '2026-03-05T08:00:00.000Z'],
      ['2026-03-10', 'UTC', '2026-03-10T00:00:00.000Z'],
    ])('resolves %s in %s', (dayKey, zone, expected) => {
      expect(startOfLocalDay(dayKey, zone).toISOString()).toBe(expected);
    });

    it('resolves zones with a half hour and a quarter hour offset', () => {
      expect(startOfLocalDay('2026-03-10', 'Asia/Kolkata').toISOString()).toBe(
        '2026-03-09T18:30:00.000Z',
      );
      expect(startOfLocalDay('2026-03-10', 'Asia/Kathmandu').toISOString()).toBe(
        '2026-03-09T18:15:00.000Z',
      );
    });

    it('resolves the day daylight saving starts', () => {
      expect(startOfLocalDay('2026-03-08', LA).toISOString()).toBe('2026-03-08T08:00:00.000Z');
    });

    it('round trips: the start of a day is still that day', () => {
      for (const zone of [KL, LA, 'Asia/Kolkata', 'UTC']) {
        expect(localDayKey(startOfLocalDay('2026-07-04', zone), zone)).toBe('2026-07-04');
      }
    });
  });

  describe('startOfLocalWeek', () => {
    it('starts the week on the local Monday', () => {
      const wednesday = new Date('2026-03-11T12:00:00Z');

      expect(startOfLocalWeek(wednesday, KL).toISOString()).toBe('2026-03-08T16:00:00.000Z');
      expect(localDayKey(startOfLocalWeek(wednesday, KL), KL)).toBe('2026-03-09');
    });

    it('puts an instant near the boundary in different weeks for different zones', () => {
      // Sunday 18:00 UTC is still Sunday in Los Angeles but already Monday in
      // Kuala Lumpur, so the two users are in different weeks.
      const instant = new Date('2026-03-08T18:00:00Z');

      expect(localDayKey(startOfLocalWeek(instant, KL), KL)).toBe('2026-03-09');
      expect(localDayKey(startOfLocalWeek(instant, LA), LA)).toBe('2026-03-02');
    });
  });

  describe('isValidTimeZone', () => {
    it('accepts real zones and rejects invented ones', () => {
      expect(isValidTimeZone(KL)).toBe(true);
      expect(isValidTimeZone('UTC')).toBe(true);
      expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    });
  });
});
