import { parseDurationToMs } from './duration.util';

describe('parseDurationToMs', () => {
  it.each([
    ['500ms', 500],
    ['30s', 30_000],
    ['30m', 1_800_000],
    ['15m', 900_000],
    ['7d', 604_800_000],
    ['2w', 1_209_600_000],
    ['1y', 31_536_000_000],
  ])('converts %s to %d ms', (duration, expectedMs) => {
    expect(parseDurationToMs(duration)).toBe(expectedMs);
  });

  it.each(['', '30', 'm30', '30 m', '30mins', '-5m'])(
    'rejects the malformed duration %p',
    (duration) => {
      expect(() => parseDurationToMs(duration)).toThrow('Invalid duration format');
    },
  );
});
