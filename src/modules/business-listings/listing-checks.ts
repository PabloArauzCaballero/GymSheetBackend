import type { ListingModerationStatus, ListingOfferKind } from '../directory/models/entity-plan.model';
import { SHAPE_BY_KIND } from './listing.catalog';

/** Fields that decide whether a listing has the shape its kind requires. */
export type ListingShape = {
  offerKind: ListingOfferKind;
  validityDays: number | null;
  sessionsCount: number | null;
  stockQuantity: number | null;
  productCategoryId: string | null;
};

export type ShapeViolation =
  | 'VALIDITY_REQUIRED'
  | 'VALIDITY_NOT_ALLOWED'
  | 'VALIDITY_TOO_SHORT'
  | 'SESSIONS_REQUIRED'
  | 'SESSIONS_NOT_ALLOWED'
  | 'STOCK_NOT_ALLOWED'
  | 'PRODUCT_CATEGORY_NOT_ALLOWED';

/** Required and forbidden fields per offer kind (plan §2.8). A violation is a 422, never a HELD listing. */
export function shapeViolations(shape: ListingShape): ShapeViolation[] {
  const rule = SHAPE_BY_KIND[shape.offerKind];
  const violations: ShapeViolation[] = [];
  if (rule.validity === 'REQUIRED' && shape.validityDays === null) violations.push('VALIDITY_REQUIRED');
  if (rule.validity === 'FORBIDDEN' && shape.validityDays !== null) violations.push('VALIDITY_NOT_ALLOWED');
  if (shape.validityDays !== null && shape.validityDays < rule.minValidityDays) violations.push('VALIDITY_TOO_SHORT');
  if (rule.sessions === 'REQUIRED' && shape.sessionsCount === null) violations.push('SESSIONS_REQUIRED');
  if (rule.sessions === 'FORBIDDEN' && shape.sessionsCount !== null) violations.push('SESSIONS_NOT_ALLOWED');
  if (!rule.stock && shape.stockQuantity !== null) violations.push('STOCK_NOT_ALLOWED');
  if (!rule.productCategory && shape.productCategoryId !== null) violations.push('PRODUCT_CATEGORY_NOT_ALLOWED');
  return violations;
}

/** Automatic publication checks; any of them holds the listing for REPP instead of publishing it. */
export type PublicationCheckCode = 'PRICE_OUT_OF_BAND' | 'PRICE_OUTLIER' | 'BANNED_TERMS';

export type PriceBand = { min: number; max: number; outlierFactor: number };

/**
 * `median` is the median price of live listings of the same kind, or null when
 * there are too few to mean anything. A price `outlierFactor` times above or
 * below it is suspicious (bait price or a typo with an extra zero).
 */
export function priceCheckCodes(price: number, band: PriceBand, median: number | null): PublicationCheckCode[] {
  if (price < band.min || price > band.max) return ['PRICE_OUT_OF_BAND'];
  if (median !== null && median > 0 && (price > median * band.outlierFactor || price * band.outlierFactor < median)) {
    return ['PRICE_OUTLIER'];
  }
  return [];
}

/**
 * Where an automatic re-check leaves a listing. LIVE and HELD follow the
 * checks; HIDDEN and REJECTED were REPP's decision and only REPP lifts them.
 */
export function moderationAfterChecks(
  current: ListingModerationStatus | null,
  codes: readonly PublicationCheckCode[],
): ListingModerationStatus {
  if (current === 'HIDDEN' || current === 'REJECTED') return current;
  return codes.length === 0 ? 'LIVE' : 'HELD';
}
