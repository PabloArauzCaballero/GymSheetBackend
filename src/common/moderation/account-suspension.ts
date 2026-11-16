import { ForbiddenException, UnauthorizedException } from "@nestjs/common";

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

/** Login and signup refusal (403: the credentials were right). Never names the year 9999. */
export function suspendedAccountError(until: Date): ForbiddenException {
  return new ForbiddenException(
    isPendingReviewSuspension(until)
      ? PENDING_REVIEW_MESSAGE
      : `Tu cuenta está suspendida hasta el ${until.toLocaleDateString("es")} por incumplir las normas de la comunidad.`,
  );
}

/** Refusal of an access token of a suspended account (checked on every request). */
export function suspendedSessionError(until: Date): UnauthorizedException {
  return new UnauthorizedException(
    isPendingReviewSuspension(until)
      ? PENDING_REVIEW_MESSAGE
      : "Tu cuenta está suspendida temporalmente por incumplir las normas de la comunidad.",
  );
}
