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
 * The reason of a sanction as the affected person reads it: the moderation
 * reason code, its category label and a short plain-language text (the same
 * words as the moderation notice). Never the reporter, the moderator or the note.
 */
export type PublicSanctionReason = { code: string; label: string; text: string };

/**
 * Stable code for clients: `ACCOUNT_SUSPENDED` with `pendingReview`, the
 * public `reason` and, for a dated suspension, its end. Clients compare the
 * code, never the sentence.
 */
function suspensionDetails(until: Date, reason: PublicSanctionReason): Record<string, unknown> {
  return isPendingReviewSuspension(until)
    ? { pendingReview: true, reason }
    : { pendingReview: false, until: until.toISOString(), reason };
}

/** Login and signup refusal (403: the credentials were right). Never names the year 9999. */
export function suspendedAccountError(until: Date, reason: PublicSanctionReason): DomainException {
  return new DomainException(
    HttpStatus.FORBIDDEN,
    "ACCOUNT_SUSPENDED",
    isPendingReviewSuspension(until)
      ? PENDING_REVIEW_MESSAGE
      : `Tu cuenta está suspendida hasta el ${until.toLocaleDateString("es")} por incumplir las normas de la comunidad.`,
    suspensionDetails(until, reason),
  );
}

/** Refusal of an access token of a suspended account (checked on every request). */
export function suspendedSessionError(until: Date, reason: PublicSanctionReason): DomainException {
  return new DomainException(
    HttpStatus.UNAUTHORIZED,
    "ACCOUNT_SUSPENDED",
    isPendingReviewSuspension(until)
      ? PENDING_REVIEW_MESSAGE
      : "Tu cuenta está suspendida temporalmente por incumplir las normas de la comunidad.",
    suspensionDetails(until, reason),
  );
}

/**
 * Login refusal of an account closed by moderation (expulsion). 403 and only
 * after the password or the identity provider proved the owner: before that,
 * every refusal is the generic 401, so the login never tells a stranger that
 * an address belongs to a banned account.
 */
export function bannedAccountError(reason: PublicSanctionReason): DomainException {
  return new DomainException(
    HttpStatus.FORBIDDEN,
    "ACCOUNT_BANNED",
    "Cerramos tu cuenta por incumplir las normas de la comunidad.",
    { reason },
  );
}
