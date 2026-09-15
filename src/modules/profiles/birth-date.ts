export const MIN_PROFILE_AGE = 12;
export const MAX_PROFILE_AGE = 100;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True if `value` is a real calendar day written as `YYYY-MM-DD` (rejects 2026-02-31). */
export function isCalendarDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Whole years between `birthDate` (`YYYY-MM-DD`) and `today`, counted in UTC. */
export function ageFromBirthDate(birthDate: string, today: Date = new Date()): number {
  const [year, month, day] = birthDate.split("-").map(Number);
  let age = today.getUTCFullYear() - year;
  const birthdayPending =
    today.getUTCMonth() + 1 < month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() < day);
  if (birthdayPending) age -= 1;
  return age;
}
