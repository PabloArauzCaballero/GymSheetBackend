import { z } from 'zod';
import { AFFILIATION_KINDS, GYM_END_REASONS, REJECT_REASONS } from './affiliation.catalog';

/** The gym is named by its public @handle or by its directory id, exactly one of them. */
const gymTarget = {
  gymHandle: z.string().trim().min(1).max(31).optional(),
  gymEntityId: z.string().uuid().optional(),
};

function oneGym(value: { gymHandle?: string; gymEntityId?: string }, context: z.RefinementCtx): void {
  if (Boolean(value.gymHandle) === Boolean(value.gymEntityId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['gymHandle'], message: 'Indica el gimnasio por @handle o por id (uno solo).' });
  }
}

/**
 * A person's request. Strict: `status`, `userId`, `confirmedAt` or any other
 * field is a 400, never a silent ignore (mass assignment). A SOCIO names the
 * location they train at; `switchGym` confirms a «cambio de gimnasio» when the
 * person is already a confirmed SOCIO elsewhere.
 */
export const personRequestSchema = z
  .object({
    ...gymTarget,
    kind: z.enum(AFFILIATION_KINDS),
    locationId: z.string().uuid().optional(),
    ciLast3: z.string().regex(/^[0-9]{3}$/u, 'Escribe los últimos 3 dígitos de tu CI.'),
    switchGym: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    oneGym(value, context);
    if (value.kind === 'SOCIO' && !value.locationId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['locationId'], message: 'Elige la sede donde entrenas.' });
    }
  });
export type PersonRequestInput = z.infer<typeof personRequestSchema>;

/** A coach business asks a gym to list it as one of its coaches. */
export const coachRequestSchema = z
  .object({ ...gymTarget, locationId: z.string().uuid().optional() })
  .strict()
  .superRefine(oneGym);
export type CoachRequestInput = z.infer<typeof coachRequestSchema>;

const note = z.string().trim().min(3).max(500).optional();

export const rejectAffiliationSchema = z.object({ reasonCode: z.enum(REJECT_REASONS), note }).strict();
export type RejectAffiliationInput = z.infer<typeof rejectAffiliationSchema>;

export const endAffiliationSchema = z.object({ reasonCode: z.enum(GYM_END_REASONS), note }).strict();
export type EndAffiliationInput = z.infer<typeof endAffiliationSchema>;

const page = {
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};

/** The gym's inbox: pending requests, oldest first, filterable by kind and location. */
export const gymRequestsQuerySchema = z
  .object({ ...page, kind: z.enum(AFFILIATION_KINDS).optional(), locationId: z.string().uuid().optional() })
  .strict();
export type GymRequestsQuery = z.infer<typeof gymRequestsQuerySchema>;

/** Confirmed members (optionally by location) or coaches, newest first. */
export const gymConfirmedQuerySchema = z.object({ ...page, locationId: z.string().uuid().optional() }).strict();
export type GymConfirmedQuery = z.infer<typeof gymConfirmedQuerySchema>;

export const ownListQuerySchema = z.object(page).strict();
export type OwnListQuery = z.infer<typeof ownListQuerySchema>;
