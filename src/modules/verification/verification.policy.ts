import { HttpStatus } from "@nestjs/common";
import { DomainException } from "../../common/errors/domain.exception";
import { VerificationStatus, VerificationStatusValue } from "./verification.catalog";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Clock seam so tests can pin "now". */
export const VERIFICATION_CLOCK = Symbol("VERIFICATION_CLOCK");
export type VerificationClock = () => Date;

/**
 * Longest a submitted selfie waits for the REPP team (legal review I-5): an
 * undecided attempt expires after this and its selfie is erased by the daily
 * privacy retention. Same 30 days as the post-decision retention, so no
 * selfie outlives 60 days in any branch. ADR-0014 justifies the figure.
 */
export const VERIFICATION_REVIEW_DEADLINE_DAYS = 30;

/** Product rules of the person verification, in one place. */
export const VERIFICATION_RULES = {
  /** How long the member has to take the selfie after receiving the gesture. */
  challengeTtlMs: 10 * MINUTE_MS,
  /** Challenges per member in a rolling window. */
  maxAttemptsPerWindow: 3,
  attemptWindowMs: DAY_MS,
  /** Gallery photos a moderator needs to compare the selfie against. */
  minProfilePhotos: 2,
  /** Selfie kept after the decision (appeals/audit), then erased. */
  decidedSelfieRetentionMs: 30 * DAY_MS,
  /** A submitted selfie nobody decided expires after this (see VERIFICATION_REVIEW_DEADLINE_DAYS). */
  reviewDeadlineMs: VERIFICATION_REVIEW_DEADLINE_DAYS * DAY_MS,
  /** A challenge nobody answered is closed after this. */
  abandonedChallengeMs: DAY_MS,
  /** Lifetime of the moderator's signed selfie link. */
  selfieLinkTtlMs: 5 * MINUTE_MS,
} as const;

const TRANSITIONS: Readonly<Record<VerificationStatusValue, readonly VerificationStatusValue[]>> = {
  PENDING_UPLOAD: [VerificationStatus.PENDING_REVIEW, VerificationStatus.EXPIRED],
  // EXPIRED: the review deadline passed or the consent was revoked before a decision.
  PENDING_REVIEW: [VerificationStatus.APPROVED, VerificationStatus.REJECTED, VerificationStatus.EXPIRED],
  APPROVED: [],
  REJECTED: [],
  EXPIRED: [],
};

export function canTransition(from: VerificationStatusValue, to: VerificationStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

/** 409 for any move the state machine does not allow. */
export function assertTransition(from: VerificationStatusValue, to: VerificationStatusValue): void {
  if (canTransition(from, to)) return;
  if (from === VerificationStatus.EXPIRED) throw challengeExpired();
  throw new DomainException(
    HttpStatus.CONFLICT,
    "VERIFICATION_STATE_CONFLICT",
    "Esta verificación ya no admite ese cambio.",
    { status: from },
  );
}

export function challengeExpired(): DomainException {
  return new DomainException(
    HttpStatus.CONFLICT,
    "VERIFICATION_CHALLENGE_EXPIRED",
    "El gesto caducó. Pide uno nuevo para volver a intentarlo.",
  );
}

export function isChallengeExpired(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

/**
 * When the member may request the next challenge, or null if now.
 * `recentAttempts` are the creation dates inside the window, newest first.
 */
export function nextAttemptAt(recentAttempts: readonly Date[], now: Date): Date | null {
  const windowStart = now.getTime() - VERIFICATION_RULES.attemptWindowMs;
  const inWindow = recentAttempts
    .map((date) => date.getTime())
    .filter((time) => time > windowStart)
    .sort((left, right) => right - left);
  if (inWindow.length < VERIFICATION_RULES.maxAttemptsPerWindow) return null;
  // The slot frees up when the oldest attempt that still counts leaves the window.
  const oldestCounted = inWindow[VERIFICATION_RULES.maxAttemptsPerWindow - 1];
  return new Date(oldestCounted + VERIFICATION_RULES.attemptWindowMs);
}

export function rateLimited(retryAt: Date, now: Date): DomainException {
  const retryAfterSeconds = Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000));
  return new DomainException(
    HttpStatus.TOO_MANY_REQUESTS,
    "VERIFICATION_RATE_LIMITED",
    "Alcanzaste el máximo de intentos de verificación por hoy. Vuelve a intentarlo más tarde.",
    { retryAfterSeconds },
  );
}

/** Cut-offs of the retention pass for a given instant. */
export function retentionCutoffs(now: Date): { decidedBefore: Date; issuedBefore: Date; submittedBefore: Date } {
  return {
    decidedBefore: new Date(now.getTime() - VERIFICATION_RULES.decidedSelfieRetentionMs),
    issuedBefore: new Date(now.getTime() - VERIFICATION_RULES.abandonedChallengeMs),
    submittedBefore: new Date(now.getTime() - VERIFICATION_RULES.reviewDeadlineMs),
  };
}
