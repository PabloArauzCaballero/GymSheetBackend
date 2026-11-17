import { env } from "../../config/env";

const HOUR_MS = 60 * 60 * 1000;

/** Day of the week (0 = Sunday) of an instant in a time zone. */
function weekdayIn(instant: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(instant);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/**
 * `start` plus `hours` counted only on business days (Monday to Friday in
 * `timeZone`): a submission sent on Friday evening with a 24 h SLA is due on
 * Monday evening. Hour by hour, so a weekend boundary inside the hour counts
 * by where the hour starts; at most a few hundred steps for the allowed SLA.
 * Public holidays are not modelled.
 */
export function addBusinessHours(start: Date, hours: number, timeZone: string = env.BUSINESS_TIME_ZONE): Date {
  let cursor = start.getTime();
  let remaining = hours;
  while (remaining > 0) {
    const day = weekdayIn(new Date(cursor), timeZone);
    cursor += HOUR_MS;
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return new Date(cursor);
}

export function reviewDueAt(submittedAt: Date): Date {
  return addBusinessHours(submittedAt, env.BUSINESS_KYC_REVIEW_SLA_HOURS);
}

export function postReviewDueAt(decidedAt: Date): Date {
  return new Date(decidedAt.getTime() + env.BUSINESS_KYC_POST_REVIEW_SLA_HOURS * HOUR_MS);
}
