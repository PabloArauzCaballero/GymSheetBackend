import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';

/** Offer kinds that open a period when their order is confirmed (a product does not). */
export const PERIOD_KINDS = ['MEMBERSHIP', 'DAY_PASS', 'MULTI_DAY_PASS', 'CLASS_PACK', 'SERVICE_SESSION', 'SERVICE_PACK'] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

export function isPeriodKind(kind: string | null | undefined): kind is PeriodKind {
  return (PERIOD_KINDS as readonly string[]).includes(kind ?? '');
}

/** A period «por vencer» from this many days before its last day (plan §2.10). */
export const EXPIRING_WITHIN_DAYS = 7;
/** Days before the end on which the reminder worker writes (0 = the last day). */
export const REMINDER_DAYS: readonly number[] = [7, 3, 1, 0];

/** What the listing sold, as the order kept it (validity = `duration_days`). */
export type SoldOffer = { offerKind: PeriodKind; validityDays: number | null; sessionsCount: number | null };
export type PeriodWindow = { startsOn: string; endsOn: string | null; sessionsTotal: number | null };

const DAY_MS = 86_400_000;

export function addDays(dateOnly: string, days: number): string {
  return new Date(Date.parse(`${dateOnly}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * The window of a new period, never an extension in place (ADR-0026): it
 * starts today, or the day after the last ACTIVE period of the same listing
 * when that one is still running, so a renewal paid early chains after it.
 * A day pass lasts one day; a pack or a session without validity has no end.
 */
export function periodWindow(offer: SoldOffer, today: string, lastActiveEndsOn: string | null): PeriodWindow {
  const startsOn = lastActiveEndsOn && lastActiveEndsOn >= today ? addDays(lastActiveEndsOn, 1) : today;
  const days = offer.offerKind === 'DAY_PASS' ? 1 : offer.validityDays;
  const sessionsTotal = offer.offerKind === 'SERVICE_SESSION' ? 1 : offer.sessionsCount;
  return { startsOn, endsOn: days && days > 0 ? addDays(startsOn, days - 1) : null, sessionsTotal: sessionsTotal ?? null };
}

/** What a reader sees: the stored status, refined by the dates. */
export type ShownStatus = 'UPCOMING' | 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'CANCELLED' | 'SUSPENDED';

export function shownStatus(period: { status: string; startsOn: string; endsOn: string | null }, today: string): ShownStatus {
  if (period.status === 'CANCELLED' || period.status === 'SUSPENDED') return period.status;
  if (period.status === 'EXPIRED' || (period.endsOn !== null && period.endsOn < today)) return 'EXPIRED';
  if (period.startsOn > today) return 'UPCOMING';
  if (period.endsOn !== null && daysBetween(today, period.endsOn) <= EXPIRING_WITHIN_DAYS) return 'EXPIRING';
  return 'ACTIVE';
}

/** Days left including none on the last day; null without an end date. */
export function daysLeft(period: { endsOn: string | null }, today: string): number | null {
  return period.endsOn === null ? null : Math.max(daysBetween(today, period.endsOn), 0);
}

/** Why a business cancels or suspends a period (the chips of «Suscriptores»). */
export const CANCEL_REASONS = ['BUYER_REQUEST', 'REFUNDED_BY_BUSINESS', 'PAYMENT_ISSUE', 'CONDUCT', 'OTHER'] as const;
export const SUSPEND_REASONS = ['BUYER_REQUEST', 'PAYMENT_ISSUE', 'HEALTH', 'CONDUCT', 'OTHER'] as const;
export type BusinessAction = 'CANCEL' | 'SUSPEND' | 'REACTIVATE';

export const REASON_TEXT: Record<(typeof CANCEL_REASONS)[number] | (typeof SUSPEND_REASONS)[number], string> = {
  BUYER_REQUEST: 'Lo pediste al negocio.',
  REFUNDED_BY_BUSINESS: 'El negocio te devolvió el pago.',
  PAYMENT_ISSUE: 'El negocio observó el pago.',
  HEALTH: 'Por un tema de salud.',
  CONDUCT: 'Por una cuestión de convivencia.',
  OTHER: 'El negocio dejó una nota.',
};

/**
 * Stored transitions a business may make. CANCELLED is final; an ACTIVE
 * period that already ended (shown EXPIRED) changes no more.
 */
export function targetOf(action: BusinessAction, current: { status: string; endsOn: string | null }, today: string): 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | null {
  const ended = current.endsOn !== null && current.endsOn < today;
  if (ended || current.status === 'CANCELLED' || current.status === 'EXPIRED') return null;
  if (action === 'CANCEL') return 'CANCELLED';
  if (action === 'SUSPEND') return current.status === 'ACTIVE' ? 'SUSPENDED' : null;
  return current.status === 'SUSPENDED' ? 'ACTIVE' : null;
}

export function invalidTransition(status: string): DomainException {
  return new DomainException(HttpStatus.CONFLICT, 'SUBSCRIPTION_INVALID_TRANSITION', 'La suscripción no está en un estado que lo permita.', { status });
}
