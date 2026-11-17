import { randomBytes } from 'node:crypto';
import type { EntityPlanType, ListingOfferKind } from '../directory/models/entity-plan.model';

export const OFFER_KINDS = [
  'MEMBERSHIP',
  'DAY_PASS',
  'MULTI_DAY_PASS',
  'CLASS_PACK',
  'PRODUCT',
  'SERVICE_SESSION',
  'SERVICE_PACK',
] as const satisfies readonly ListingOfferKind[];

/** The legacy `type` column, derived from the offer kind (ck_entity_plan_type_of_kind). */
export const LEGACY_TYPE_OF: Record<ListingOfferKind, EntityPlanType> = {
  MEMBERSHIP: 'MEMBERSHIP_PLAN',
  DAY_PASS: 'PASS',
  MULTI_DAY_PASS: 'PASS',
  CLASS_PACK: 'PASS',
  PRODUCT: 'PRODUCT',
  SERVICE_SESSION: 'SERVICE',
  SERVICE_PACK: 'SERVICE',
};

/** How a legacy plan (only `type`) maps to an offer kind; the migration applies the same rule. */
export function legacyOfferKind(type: EntityPlanType, durationDays: number | null | undefined): ListingOfferKind {
  if (type === 'MEMBERSHIP_PLAN') return 'MEMBERSHIP';
  if (type === 'PASS') return durationDays && durationDays > 1 ? 'MULTI_DAY_PASS' : 'DAY_PASS';
  if (type === 'SERVICE') return 'SERVICE_SESSION';
  return 'PRODUCT';
}

type Presence = 'REQUIRED' | 'OPTIONAL' | 'FORBIDDEN';

/** Which fields each kind takes. The database re-checks the parts a public listing depends on. */
export const SHAPE_BY_KIND: Record<
  ListingOfferKind,
  { validity: Presence; minValidityDays: number; sessions: Presence; stock: boolean; productCategory: boolean }
> = {
  MEMBERSHIP: { validity: 'REQUIRED', minValidityDays: 1, sessions: 'FORBIDDEN', stock: false, productCategory: false },
  DAY_PASS: { validity: 'FORBIDDEN', minValidityDays: 1, sessions: 'FORBIDDEN', stock: false, productCategory: false },
  MULTI_DAY_PASS: { validity: 'REQUIRED', minValidityDays: 2, sessions: 'FORBIDDEN', stock: false, productCategory: false },
  CLASS_PACK: { validity: 'OPTIONAL', minValidityDays: 1, sessions: 'REQUIRED', stock: false, productCategory: false },
  SERVICE_SESSION: { validity: 'FORBIDDEN', minValidityDays: 1, sessions: 'FORBIDDEN', stock: false, productCategory: false },
  SERVICE_PACK: { validity: 'OPTIONAL', minValidityDays: 1, sessions: 'REQUIRED', stock: false, productCategory: false },
  PRODUCT: { validity: 'FORBIDDEN', minValidityDays: 1, sessions: 'FORBIDDEN', stock: true, productCategory: true },
};

/** Every listing is priced in bolivianos (owner decision, plan Q8); ck_entity_plan_live_currency. */
export const LISTING_CURRENCY = 'BOB';
export const LISTING_MEDIA_MAX = 10;
/** Listings a business keeps open (not archived): bounds the panel, the search and a spam flood. */
export const LISTINGS_MAX = 500;
export const ENTITY_LOCATIONS_MAX = 50;

/** URL-safe, unique per listing thanks to the random suffix; never shown as an identifier. */
export function listingSlug(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 160);
  return `${base || 'publicacion'}-${randomBytes(4).toString('hex')}`;
}
