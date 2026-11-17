import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';

export const AFFILIATION_KINDS = ['SOCIO', 'ENTRENADOR'] as const;
export type AffiliationKind = (typeof AFFILIATION_KINDS)[number];

export type AffiliationStatus = 'REQUESTED' | 'CONFIRMED' | 'REJECTED' | 'ENDED' | 'CANCELLED';
export const LIVE_STATUSES: readonly AffiliationStatus[] = ['REQUESTED', 'CONFIRMED'];

/** Why the gym rejects a request (the chips of «Socios», plan §4.2). */
export const REJECT_REASONS = ['UNKNOWN_PERSON', 'CI_MISMATCH', 'WRONG_LOCATION', 'NOT_A_COACH_HERE', 'OTHER'] as const;
/** Why the gym ends a confirmed affiliation. */
export const GYM_END_REASONS = ['NO_LONGER_MEMBER', 'NO_LONGER_COACH', 'CONDUCT', 'OTHER'] as const;
export type GymReason = (typeof REJECT_REASONS)[number] | (typeof GYM_END_REASONS)[number];
/** Closed by the subject (cancel or leave) or by the system (a confirmed gym switch, the account closure). */
export type SystemReason = 'WITHDRAWN' | 'LEFT' | 'SWITCHED_GYM' | 'ACCOUNT_CLOSED';

export const REASON_TEXT: Record<GymReason, string> = {
  UNKNOWN_PERSON: 'El gimnasio no te reconoce como socio o entrenador.',
  CI_MISMATCH: 'Los dígitos del CI no coinciden con los del gimnasio.',
  WRONG_LOCATION: 'La sede que elegiste no es la tuya.',
  NOT_A_COACH_HERE: 'El gimnasio no te tiene como entrenador.',
  NO_LONGER_MEMBER: 'El gimnasio indicó que ya no eres socio.',
  NO_LONGER_COACH: 'El gimnasio indicó que ya no entrenas allí.',
  CONDUCT: 'El gimnasio terminó la afiliación por una cuestión de convivencia.',
  OTHER: 'El gimnasio dejó una nota.',
};

/**
 * Anti-spam limits (ADR-0025), constants on purpose: they shape what a gym
 * receives, not a deploy setting.
 * - A person keeps at most 5 pending requests (SOCIO is at most 1: DB index).
 * - A coach business keeps at most 10 pending gym links.
 * - After a gym rejects (or ends) one, the same subject cannot ask that gym
 *   for the same kind again for 7 days; after cancelling their own, 1 day.
 */
export const AFFILIATION_LIMITS = {
  personPending: 5,
  coachPending: 10,
  gymDecisionCooldownDays: 7,
  withdrawalCooldownDays: 1,
} as const;

/** Gym-side reasons: a closure for one of these starts the long cooldown. */
export const GYM_DECIDED_REASONS: readonly string[] = [...new Set<string>([...REJECT_REASONS, ...GYM_END_REASONS])];

export function invalidTransition(status: AffiliationStatus): DomainException {
  return new DomainException(HttpStatus.CONFLICT, 'AFFILIATION_INVALID_TRANSITION', 'La afiliación no está en un estado que lo permita.', { status });
}

export function noteRequired(): DomainException {
  return new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, 'AFFILIATION_NOTE_REQUIRED', 'Explica el motivo para que la persona sepa qué pasó.');
}

export function wrongBusinessType(expected: 'GYM' | 'COACH'): DomainException {
  return new DomainException(
    HttpStatus.FORBIDDEN,
    'BUSINESS_TYPE_NOT_ALLOWED',
    expected === 'GYM' ? 'Solo un gimnasio gestiona afiliaciones.' : 'Solo una cuenta de coach pide vínculos con gimnasios.',
  );
}

const DAY_MS = 86_400_000;

/**
 * Until when the subject may not ask the same gym for the same kind again,
 * given the latest closed row of that pair; null when nothing holds it back.
 * Leaving on one's own, a gym switch or a closure hold nothing back.
 */
export function cooldownUntil(last: { reasonCode: string; closedAt: Date } | null, now: Date): Date | null {
  if (!last) return null;
  const days = GYM_DECIDED_REASONS.includes(last.reasonCode)
    ? AFFILIATION_LIMITS.gymDecisionCooldownDays
    : last.reasonCode === 'WITHDRAWN'
      ? AFFILIATION_LIMITS.withdrawalCooldownDays
      : 0;
  const until = new Date(new Date(last.closedAt).getTime() + days * DAY_MS);
  return until > now ? until : null;
}
