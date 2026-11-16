import { z } from 'zod';
import { normalizedEmailSchema } from '../auth/auth.schemas';
import { entityTypeEnum } from '../directory/directory.schemas';
import { signupAcceptanceSchema } from '../legal/legal.schemas';

/** A commercial name in NFKC, so look-alike full-width or compatibility forms fold before any check. */
const businessNameSchema = z
  .string()
  .max(720)
  .transform((name) => name.normalize('NFKC').trim())
  .pipe(z.string().min(2).max(180));

export const legalKindEnum = z.enum(['COMPANY', 'INDIVIDUAL']);
export type LegalKind = z.infer<typeof legalKindEnum>;

/**
 * `POST /business/signup`. No birth date, sex or onboarding: a business is not
 * a person. The anti-automation evidence is the same as the person signup
 * (ticket from `GET /auth/register/ticket`, honeypot `website`, Turnstile or
 * attestation), evaluated by the same layer (ADR-0013).
 */
export const businessSignupSchema = z.object({
  email: normalizedEmailSchema,
  password: z.string().min(8).max(128),
  businessName: businessNameSchema,
  entityType: entityTypeEnum,
  /** Only SERVICE_PROVIDER chooses; the other types have a fixed one. */
  legalKind: legalKindEnum.optional(),
  acceptances: z.array(signupAcceptanceSchema).min(1).max(5),
  ticket: z.string().trim().min(1).max(4096).optional(),
  website: z.string().max(500).optional(),
  turnstileToken: z.string().trim().min(1).max(4096).optional(),
  attestation: z
    .object({
      platform: z.enum(['ios', 'android']),
      token: z.string().trim().min(1).max(16384),
      nonce: z.string().trim().min(1).max(512),
    })
    .optional(),
});
export type BusinessSignupInput = z.infer<typeof businessSignupSchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u, 'Hora en formato HH:MM.');
const weekday = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const contactKey = z.enum(['phone', 'whatsapp', 'email', 'website', 'instagram', 'facebook', 'tiktok']);

/**
 * Profile fields. Most are non-material and published as they are; `name` and
 * `primaryCategoryId` are material: free (with the name checks) while the
 * listing is DRAFT, a KYC review once it is past DRAFT (ADR-0020).
 */
export const businessProfilePatchSchema = z
  .object({
    name: businessNameSchema,
    headline: z.string().trim().max(255).nullable(),
    description: z.string().trim().max(5000),
    primaryCategoryId: z.string().uuid(),
    city: z.string().trim().min(2).max(100),
    country: z.string().trim().min(2).max(60),
    address: z.string().trim().max(500).nullable(),
    isOnlineOnly: z.boolean(),
    contactInfo: z.record(contactKey, z.string().trim().min(1).max(200)),
    businessHours: z.record(weekday, z.object({ open: hhmm, close: hhmm })),
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Envía al menos un campo.' });
export type BusinessProfilePatch = z.infer<typeof businessProfilePatchSchema>;

export const businessHandleSchema = z.object({ handle: z.string().trim().min(1).max(64) });
export type BusinessHandleInput = z.infer<typeof businessHandleSchema>;

export const businessMediaSlotEnum = z.enum(['LOGO', 'COVER']);
export type BusinessMediaSlot = z.infer<typeof businessMediaSlotEnum>;
export const businessMediaBodySchema = z.object({ slot: businessMediaSlotEnum });

/** Path parameter of the public handle routes; the service normalizes it. */
export const handleParamSchema = z.string().trim().min(1).max(64);
