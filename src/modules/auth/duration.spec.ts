import { durationToMilliseconds } from './duration';

describe('durationToMilliseconds', () => {
  it.each([
    ['15m', 900_000],
    ['90d', 90 * 86_400_000],
    ['7d', 604_800_000],
    ['2w', 1_209_600_000],
    ['500ms', 500],
  ])('%s', (duration, expected) => {
    expect(durationToMilliseconds(duration)).toBe(expected);
  });

  it('rejects a format the env schema would not accept', () => {
    expect(() => durationToMilliseconds('ten days')).toThrow();
  });
});
