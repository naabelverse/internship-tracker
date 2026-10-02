import { describe, expect, it } from 'vitest';
import { buildCells } from '@/features/dashboard/heatmapCells';
import { makeTimelinePoint } from '../utils/factories';

/*
  The server buckets each day on the user's local midnight and sends it as a
  UTC instant. The heatmap used to take that string's first ten characters and
  key its own cells by the browser's UTC date, so east of UTC every count was
  drawn a day early from 08:00 local (UTC+8) onwards, and west of UTC the grid
  itself slid a day once the UTC date rolled over in the evening.

  Each case pins one local day — Friday 2 Oct 2026 — and reads the grid at
  times of day on both sides of the UTC date change. Today is the fifth cell of
  the last week: index 77 + 4.
*/
const TODAY_INDEX = 81;

function countOn(cells: ReturnType<typeof buildCells>, key: string): number | undefined {
  return cells.find((cell) => cell.key === key)?.count;
}

describe('buildCells', () => {
  describe('Asia/Kuala_Lumpur (UTC+8)', () => {
    const zone = 'Asia/Kuala_Lumpur';
    const points = [
      // Local Friday 2 Oct and Monday 28 Sep, each at its local midnight.
      makeTimelinePoint({ bucket: '2026-10-01T16:00:00.000Z', created: 3 }),
      makeTimelinePoint({ bucket: '2026-09-27T16:00:00.000Z', created: 1 }),
    ];

    it.each([
      ['07:30 local, still 1 Oct in UTC', '2026-10-01T23:30:00.000Z'],
      ['13:00 local, 2 Oct in UTC too', '2026-10-02T05:00:00.000Z'],
      ['23:59 local', '2026-10-02T15:59:00.000Z'],
    ])('puts each day on its own local date at %s', (_label, now) => {
      const cells = buildCells(points, new Date(now), zone);

      expect(cells).toHaveLength(84);
      expect(cells[TODAY_INDEX]?.key).toBe('2026-10-02');
      expect(cells[77]?.key).toBe('2026-09-28');
      expect(countOn(cells, '2026-10-02')).toBe(3);
      expect(countOn(cells, '2026-09-28')).toBe(1);
      expect(countOn(cells, '2026-10-01')).toBe(0);
      expect(countOn(cells, '2026-09-27')).toBe(0);
    });
  });

  describe('America/Los_Angeles (UTC-7 in October)', () => {
    const zone = 'America/Los_Angeles';
    const points = [makeTimelinePoint({ bucket: '2026-10-02T07:00:00.000Z', created: 3 })];

    it.each([
      ['01:00 local', '2026-10-02T08:00:00.000Z'],
      ['13:00 local', '2026-10-02T20:00:00.000Z'],
      ['22:30 local, already 3 Oct in UTC', '2026-10-03T05:30:00.000Z'],
    ])('puts each day on its own local date at %s', (_label, now) => {
      const cells = buildCells(points, new Date(now), zone);

      expect(cells[TODAY_INDEX]?.key).toBe('2026-10-02');
      expect(cells[77]?.key).toBe('2026-09-28');
      expect(countOn(cells, '2026-10-02')).toBe(3);
      // Saturday is a later day of the current week: a cell, but an empty one.
      expect(countOn(cells, '2026-10-03')).toBe(0);
      expect(countOn(cells, '2026-10-01')).toBe(0);
    });
  });

  it('keeps one cell per local day across a daylight saving change', () => {
    // New York leaves daylight time on Sunday 1 Nov 2026; local midnight moves
    // from 04:00Z to 05:00Z, and a 23- or 25-hour day must not skip or repeat.
    const cells = buildCells(
      [
        makeTimelinePoint({ bucket: '2026-10-30T04:00:00.000Z', created: 2 }),
        makeTimelinePoint({ bucket: '2026-11-02T05:00:00.000Z', created: 5 }),
      ],
      new Date('2026-11-10T17:00:00.000Z'),
      'America/New_York',
    );
    const keys = cells.map((cell) => cell.key);
    const dayStart = (key: string | undefined): number => Date.parse(`${key ?? ''}T00:00:00Z`);

    expect(new Set(keys).size).toBe(84);
    for (let index = 1; index < keys.length; index += 1) {
      expect(dayStart(keys[index]) - dayStart(keys[index - 1])).toBe(86_400_000);
    }
    expect(new Date(dayStart(keys[0])).getUTCDay()).toBe(1);
    expect(countOn(cells, '2026-10-30')).toBe(2);
    expect(countOn(cells, '2026-11-02')).toBe(5);
  });

  it('adds buckets that land on the same local day', () => {
    const cells = buildCells(
      [
        makeTimelinePoint({ bucket: '2026-10-01T16:00:00.000Z', created: 2 }),
        makeTimelinePoint({ bucket: '2026-10-01T16:00:00.000Z', created: 1 }),
      ],
      new Date('2026-10-02T05:00:00.000Z'),
      'Asia/Kuala_Lumpur',
    );

    expect(countOn(cells, '2026-10-02')).toBe(3);
  });
});
