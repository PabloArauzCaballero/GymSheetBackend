const UNIT_MILLISECONDS = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  y: 31_557_600_000,
} as const;

/**
 * Converts the duration format accepted by the env schema (`15m`, `90d`, the
 * same one `jsonwebtoken` takes) to milliseconds.
 */
export function durationToMilliseconds(duration: string): number {
  const match = /^(\d+)(ms|s|m|h|d|w|y)$/.exec(duration.trim());
  if (!match) {
    throw new Error(`Unsupported duration: ${duration}`);
  }
  const unit = match[2] as keyof typeof UNIT_MILLISECONDS;
  return Number(match[1]) * UNIT_MILLISECONDS[unit];
}
