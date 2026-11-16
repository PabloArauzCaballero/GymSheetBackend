import { HttpStatus } from "@nestjs/common";
import { DomainException } from "../errors/domain.exception";

/**
 * "Indefinite, pending review": `suspended_until` is a timestamp, and a real
 * far date keeps every existing suspension check working. Only a moderator
 * decision (dismiss or confirm) ends it, never the calendar.
 */
export const PENDING_REVIEW_SUSPENSION_UNTIL = new Date("9999-12-31T23:59:59.000Z");

/** Any end in the sentinel's year is the open-ended suspension, whatever its time of day. */
export function isPendingReviewSuspension(until: Date): boolean {
  return until.getUTCFullYear() >= PENDING_REVIEW_SUSPENSION_UNTIL.getUTCFullYear();
}

const PENDING_REVIEW_MESSAGE = "Tu cuenta está suspendida mientras revisamos un reporte.";

/**
 * Stable code for clients: `ACCOUNT_SUSPENDED` with `pendingReview` and, for a
 * dated suspension, its end. Clients compare the code, never the sentence.
 */
function suspensionDetails(until: Date): Record<string, unknown> {
  return isPendingReviewSuspension(until) ? { pendingReview: true } : { pendingReview: false, until: until.toISOString() };
}

/** Login and signup refusal (403: the credentials were right). Never names the year 9999. */
export function suspendedAccountError(until: Date): DomainException {
  return new DomainException(
    HttpStatus.FORBIDDEN,
    "ACCOUNT_SUSPENDED",
    isPendingReviewSuspension(until)
      ? PENDING_REVIEW_MESSAGE
      : `Tu cuenta está suspendida hasta el ${until.toLocaleDateString("es")} por incumplir las normas de la comunidad.`,
    suspensionDetails(until),
  );
}

/** Refusal of an access token of a suspended account (checked on every request). */
export function suspendedSessionError(until: Date): DomainException {
  return new DomainException(
    HttpStatus.UNAUTHORIZED,
    "ACCOUNT_SUSPENDED",
    isPendingReviewSuspension(until)
      ? PENDING_REVIEW_MESSAGE
      : "Tu cuenta está suspendida temporalmente por incumplir las normas de la comunidad.",
    suspensionDetails(until),
  );
}
