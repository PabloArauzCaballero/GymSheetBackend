const DURATION_UNIT_MS: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  y: 31_536_000_000,
};

const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d|w|y)$/;

/**
 * Converts a JWT-style duration string (`"30m"`, `"7d"`) to milliseconds, so
 * the same human-readable env values that configure token `expiresIn` can
 * also compute a plain `Date` expiry for tokens that are not JWTs (refresh
 * and password-reset tokens are opaque, hashed, and stored, not signed).
 */
export function parseDurationToMs(duration: string): number {
  const match = DURATION_PATTERN.exec(duration);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }

  const [, amount, unit] = match;
  return Number(amount) * DURATION_UNIT_MS[unit];
}
