/**
 * Format rules of the Bolivian identity data of a KYC (plan §2.6). Only the
 * SHAPE is checked: no check digit is computed, because none is published for
 * the NIT or the CI and inventing one would reject real numbers. Whether a
 * number exists is REPP's post-review (and, some day, SIN/SEGIP).
 */

/** NIT: digits only. Length range, pending confirmation of the SIN formats. */
export const NIT_LENGTH = { min: 7, max: 13 } as const;
export const CI_EXTENSIONS = ["LP", "CB", "SC", "OR", "PT", "TJ", "CH", "BE", "PD"] as const;
export type CiExtension = (typeof CI_EXTENSIONS)[number];

/** Digits of a NIT, or null when it is not one (spaces, dots and dashes are tolerated and dropped). */
export function normalizeNit(input: string): string | null {
  const digits = input.replace(/[\s.-]/gu, "");
  if (!/^\d+$/u.test(digits)) return null;
  return digits.length >= NIT_LENGTH.min && digits.length <= NIT_LENGTH.max ? digits : null;
}

export type ParsedCi = { number: string; complement: string | null; extension: CiExtension | null };

/** CI: 4–10 digits, an optional 2-character complement and an optional department. */
export function parseCi(number: string, complement?: string | null, extension?: string | null): ParsedCi | null {
  const digits = number.replace(/[\s.]/gu, "");
  if (!/^\d{4,10}$/u.test(digits)) return null;
  const comp = complement?.trim().toUpperCase() || null;
  if (comp !== null && !/^[0-9A-Z]{2}$/u.test(comp)) return null;
  const ext = extension?.trim().toUpperCase() || null;
  if (ext !== null && !(CI_EXTENSIONS as readonly string[]).includes(ext)) return null;
  return { number: digits, complement: comp, extension: ext as CiExtension | null };
}

/**
 * What a CI fingerprint (HMAC) is computed from: the NUMBER alone. The
 * complement tells apart two people SEGIP gave the same number, but keying on
 * it let a blocked or duplicated CI pass by adding, changing or dropping the
 * complement. Matching on the number at worst sends a legitimate homonym to
 * REPP review (WARN / FAIL → IN_REVIEW); it never rejects.
 */
export function ciFingerprintValue(ci: ParsedCi): string {
  return ci.number;
}

/** Bolivian mobile in E.164 (`+591` and 8 digits starting with 6 or 7), or null. */
export function normalizeBolivianMobile(input: string): string | null {
  const compact = input.replace(/[\s().-]/gu, "");
  const match = /^(?:\+?591)?([67]\d{7})$/u.exec(compact);
  return match ? `+591${match[1]}` : null;
}

/** Only the last digits stay readable: `••••4567`. */
export function maskTail(value: string, visible = 3): string {
  const tail = value.slice(-visible);
  return `${"•".repeat(Math.max(0, Math.min(value.length - visible, 8)))}${tail}`;
}
