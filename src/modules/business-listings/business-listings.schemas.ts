import { z } from 'zod';
import { entityTypeEnum } from '../directory/directory.schemas';
import { OFFER_KINDS } from './listing.catalog';

export const offerKindEnum = z.enum(OFFER_KINDS);

/** BOB with at most two decimals. The band is a publication check (HELD), not a validation. */
const price = z
  .number()
  .min(0)
  .max(10_000_000)
  .refine((value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6, { message: 'Usa como máximo dos decimales.' });
const text = (max: number) => z.string().trim().max(max);

/**
 * `POST /business/me/listings`. Strict: the seller never writes the moderation
 * state, the currency (always BOB), the reserved stock or the legacy `type`.
 */
export const createListingSchema = z
  .object({
    offerKind: offerKindEnum,
    name: text(180).pipe(z.string().min(2)),
    description: text(5000).pipe(z.string().min(5)),
    benefits: z.array(text(200).pipe(z.string().min(1))).max(20).default([]),
    price,
    validityDays: z.number().int().min(1).max(3650).nullable().default(null),
    sessionsCount: z.number().int().min(1).max(1000).nullable().default(null),
    stockQuantity: z.number().int().min(0).max(1_000_000).nullable().default(null),
    productCategoryId: z.string().uuid().nullable().default(null),
    displayOrder: z.number().int().min(0).max(10_000).default(0),
  })
  .strict();
export type CreateListingInput = z.infer<typeof createListingSchema>;

/** `PATCH /business/me/listings/:id`. The kind is fixed: another kind is another listing. */
export const updateListingSchema = z
  .object({
    name: text(180).pipe(z.string().min(2)),
    description: text(5000).pipe(z.string().min(5)),
    benefits: z.array(text(200).pipe(z.string().min(1))).max(20),
    validityDays: z.number().int().min(1).max(3650).nullable(),
    sessionsCount: z.number().int().min(1).max(1000).nullable(),
    productCategoryId: z.string().uuid().nullable(),
    displayOrder: z.number().int().min(0).max(10_000),
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Envía al menos un campo.' });
export type UpdateListingInput = z.infer<typeof updateListingSchema>;

export const listingPriceSchema = z.object({ price, reason: text(500).optional() }).strict();
export type ListingPriceInput = z.infer<typeof listingPriceSchema>;

export const listingStockSchema = z.object({ stockQuantity: z.number().int().min(0).max(1_000_000).nullable() }).strict();
export type ListingStockInput = z.infer<typeof listingStockSchema>;

const cursor = z.string().trim().min(1).max(400).optional();
const limit = z.coerce.number().int().min(1).max(50).default(20);

export const ownListingsQuerySchema = z
  .object({
    status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
    moderationStatus: z.enum(['LIVE', 'HELD', 'HIDDEN', 'REJECTED']).optional(),
    cursor,
    limit,
  })
  .strict();
export type OwnListingsQuery = z.infer<typeof ownListingsQuerySchema>;

const money = z.coerce.number().min(0).max(10_000_000);
const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

/** Public search (plan §3.2). Snake case like the other public directory filters. */
export const publicListingsQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    offer_kind: offerKindEnum.optional(),
    entity_type: entityTypeEnum.optional(),
    entity_id: z.string().uuid().optional(),
    // Dotted materialized path: letters, digits and dashes only, so it can never carry a LIKE wildcard.
    category_path: z.string().trim().max(200).regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*$/u).optional(),
    city: z.string().trim().min(2).max(100).optional(),
    price_min: money.optional(),
    price_max: money.optional(),
    verified_only: booleanFlag.optional(),
    sort: z.enum(['recent', 'price_asc', 'price_desc']).default('recent'),
    cursor,
    limit,
  })
  .strict()
  .refine((query) => query.price_min === undefined || query.price_max === undefined || query.price_min <= query.price_max, {
    message: 'price_min no puede ser mayor que price_max.',
    path: ['price_min'],
  });
export type PublicListingsQuery = z.infer<typeof publicListingsQuerySchema>;

export const listingMediaPositionSchema = z.coerce.number().int().min(0).max(50);

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u, 'Hora en formato HH:MM.');
const weekday = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

const locationFields = {
  name: text(120).pipe(z.string().min(2)),
  address: text(500).nullable(),
  city: text(100).pipe(z.string().min(2)),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  businessHours: z.record(weekday, z.object({ open: hhmm, close: hhmm })),
  displayOrder: z.number().int().min(0).max(10_000),
};

const coordinatesPaired = (value: { latitude?: number | null; longitude?: number | null }) =>
  (value.latitude === undefined) === (value.longitude === undefined) && (value.latitude === null) === (value.longitude === null);

export const createLocationSchema = z
  .object({
    ...locationFields,
    address: locationFields.address.default(null),
    latitude: locationFields.latitude.default(null),
    longitude: locationFields.longitude.default(null),
    businessHours: locationFields.businessHours.default({}),
    displayOrder: locationFields.displayOrder.default(0),
  })
  .strict()
  .refine(coordinatesPaired, { message: 'Envía latitud y longitud juntas.', path: ['latitude'] });
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

export const updateLocationSchema = z
  .object(locationFields)
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Envía al menos un campo.' })
  .refine(coordinatesPaired, { message: 'Envía latitud y longitud juntas.', path: ['latitude'] });
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

/** REPP's console over listings (held by the checks, hidden or rejected). */
export const adminListingsQuerySchema = z
  .object({ moderationStatus: z.enum(['HELD', 'HIDDEN', 'REJECTED']).default('HELD'), cursor, limit })
  .strict();
export type AdminListingsQuery = z.infer<typeof adminListingsQuerySchema>;

export const LISTING_REJECTION_REASONS = ['PROHIBITED_PRODUCT', 'MISLEADING', 'PRICE_ABUSE', 'DUPLICATE', 'OTHER'] as const;
export const adminListingDecisionSchema = z
  .object({ reasonCode: z.enum(LISTING_REJECTION_REASONS), note: text(1000).optional() })
  .strict();
export type AdminListingDecisionInput = z.infer<typeof adminListingDecisionSchema>;
/**
 * `seenUpdatedAt` is the listing's `updatedAt` exactly as `GET /admin/business/listings`
 * returned it (ISO instant, microseconds): REPP publishes only the version it reviewed.
 */
export const adminListingReleaseSchema = z
  .object({
    seenUpdatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/u, 'Instante ISO en UTC.'),
    note: text(1000).optional(),
  })
  .strict();
export type AdminListingReleaseInput = z.infer<typeof adminListingReleaseSchema>;
