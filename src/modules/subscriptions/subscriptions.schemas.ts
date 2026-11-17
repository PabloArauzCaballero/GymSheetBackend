import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { DomainException } from '../../common/errors/domain.exception';
import { CANCEL_REASONS, SUSPEND_REASONS } from './subscription.catalog';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** «Suscriptores» of the business: `status=EXPIRING` is «por vencer», `EXPIRED` «vencidos». */
export const subscribersQuerySchema = z
  .object({
    status: z.enum(['ACTIVE', 'EXPIRING', 'EXPIRED', 'SUSPENDED', 'CANCELLED']).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type SubscribersQuery = z.infer<typeof subscribersQuerySchema>;

const note = z.string().trim().min(3).max(500).optional();

export const cancelPeriodSchema = z.object({ reasonCode: z.enum(CANCEL_REASONS), note }).strict();
export const suspendPeriodSchema = z.object({ reasonCode: z.enum(SUSPEND_REASONS), note }).strict();
export type PeriodDecisionInput = { reasonCode: (typeof CANCEL_REASONS)[number] | (typeof SUSPEND_REASONS)[number]; note?: string };

/** Keyset cursor of «Suscriptores»: `base64url("<end date>|<id>")`; a tampered one is a 400. */
export function encodeSubscriberCursor(endsOn: string | null, id: string): string {
  return Buffer.from(`${endsOn ?? '9999-12-31'}|${id}`, 'utf8').toString('base64url');
}

export function decodeSubscriberCursor(cursor: string | undefined): { key: string; id: string } | null {
  if (!cursor) return null;
  const [key, id, extra] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!key || !id || extra !== undefined || !DATE.test(key) || !UUID.test(id) || Number.isNaN(Date.parse(key))) {
    throw new DomainException(HttpStatus.BAD_REQUEST, 'INVALID_CURSOR', 'El cursor no es válido; vuelve a la primera página.');
  }
  return { key, id };
}
