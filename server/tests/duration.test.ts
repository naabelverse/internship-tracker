import { parseDuration, parseDurationSeconds } from '@/utils/duration';

describe('parseDuration', () => {
  it.each([
    ['30s', 30_000],
    ['15m', 900_000],
    ['1h', 3_600_000],
    ['7d', 604_800_000],
  ])('parses %s', (input, expected) => {
    expect(parseDuration(input as string)).toBe(expected);
  });

  it('ignores surrounding whitespace', () => {
    expect(parseDuration('  15m  ')).toBe(900_000);
  });

  it.each(['', '15', 'm', '15x', '-5m', '1.5h', '15 m', 'fifteen minutes'])(
    'rejects %s',
    (input) => {
      expect(() => parseDuration(input)).toThrow(/Invalid duration/);
    },
  );

  it('rejects a zero duration, which would issue tokens that are already expired', () => {
    expect(() => parseDuration('0m')).toThrow(/greater than zero/);
  });
});

describe('parseDurationSeconds', () => {
  it('converts to whole seconds for JWT expiresIn', () => {
    expect(parseDurationSeconds('15m')).toBe(900);
    expect(parseDurationSeconds('7d')).toBe(604_800);
  });
});
