import { ListingShape, moderationAfterChecks, priceCheckCodes, shapeViolations } from './listing-checks';
import { LEGACY_TYPE_OF, OFFER_KINDS, legacyOfferKind } from './listing.catalog';

const band = { min: 1, max: 50_000, outlierFactor: 5 };
const shape = (patch: Partial<ListingShape> & Pick<ListingShape, 'offerKind'>): ListingShape => ({
  validityDays: null,
  sessionsCount: null,
  stockQuantity: null,
  productCategoryId: null,
  ...patch,
});

describe('publication checks (ADR-0022)', () => {
  describe('price band and outlier', () => {
    it('inside the band and near the median passes', () => {
      expect(priceCheckCodes(250, band, 200)).toEqual([]);
      expect(priceCheckCodes(1, band, null)).toEqual([]);
      expect(priceCheckCodes(50_000, band, null)).toEqual([]);
    });

    it('below or above the band is PRICE_OUT_OF_BAND, whatever the median says', () => {
      expect(priceCheckCodes(0, band, null)).toEqual(['PRICE_OUT_OF_BAND']);
      expect(priceCheckCodes(0.99, band, 1)).toEqual(['PRICE_OUT_OF_BAND']);
      expect(priceCheckCodes(50_000.01, band, 50_000)).toEqual(['PRICE_OUT_OF_BAND']);
    });

    it('more than the factor above or below the median is PRICE_OUTLIER (bait price, extra zero)', () => {
      expect(priceCheckCodes(1001, band, 200)).toEqual(['PRICE_OUTLIER']);
      expect(priceCheckCodes(1000, band, 200)).toEqual([]);
      expect(priceCheckCodes(39, band, 200)).toEqual(['PRICE_OUTLIER']);
      expect(priceCheckCodes(40, band, 200)).toEqual([]);
    });

    it('without a meaningful median there is no outlier check', () => {
      expect(priceCheckCodes(49_000, band, null)).toEqual([]);
      expect(priceCheckCodes(49_000, band, 0)).toEqual([]);
    });
  });

  describe('required fields per offer kind', () => {
    it('a membership and a multi-day pass need their validity; a multi-day pass at least two days', () => {
      expect(shapeViolations(shape({ offerKind: 'MEMBERSHIP' }))).toEqual(['VALIDITY_REQUIRED']);
      expect(shapeViolations(shape({ offerKind: 'MEMBERSHIP', validityDays: 30 }))).toEqual([]);
      expect(shapeViolations(shape({ offerKind: 'MULTI_DAY_PASS', validityDays: 1 }))).toEqual(['VALIDITY_TOO_SHORT']);
      expect(shapeViolations(shape({ offerKind: 'MULTI_DAY_PASS', validityDays: 10 }))).toEqual([]);
    });

    it('packs need their sessions; nothing else takes sessions', () => {
      expect(shapeViolations(shape({ offerKind: 'CLASS_PACK' }))).toEqual(['SESSIONS_REQUIRED']);
      expect(shapeViolations(shape({ offerKind: 'SERVICE_PACK', sessionsCount: 8, validityDays: 60 }))).toEqual([]);
      expect(shapeViolations(shape({ offerKind: 'SERVICE_SESSION', sessionsCount: 1 }))).toEqual(['SESSIONS_NOT_ALLOWED']);
      expect(shapeViolations(shape({ offerKind: 'MEMBERSHIP', validityDays: 30, sessionsCount: 4 }))).toEqual(['SESSIONS_NOT_ALLOWED']);
    });

    it('a product has no validity; only a product takes stock and a product category', () => {
      expect(shapeViolations(shape({ offerKind: 'PRODUCT', validityDays: 30 }))).toEqual(['VALIDITY_NOT_ALLOWED']);
      expect(shapeViolations(shape({ offerKind: 'PRODUCT', stockQuantity: 5, productCategoryId: 'c' }))).toEqual([]);
      expect(shapeViolations(shape({ offerKind: 'DAY_PASS', stockQuantity: 5 }))).toEqual(['STOCK_NOT_ALLOWED']);
      expect(shapeViolations(shape({ offerKind: 'SERVICE_SESSION', productCategoryId: 'c' }))).toEqual(['PRODUCT_CATEGORY_NOT_ALLOWED']);
      expect(shapeViolations(shape({ offerKind: 'DAY_PASS', validityDays: 1 }))).toEqual(['VALIDITY_NOT_ALLOWED']);
    });
  });

  describe('moderation after the checks', () => {
    it('passing publishes, failing holds', () => {
      expect(moderationAfterChecks(null, [])).toBe('LIVE');
      expect(moderationAfterChecks(null, ['BANNED_TERMS'])).toBe('HELD');
      expect(moderationAfterChecks('HELD', [])).toBe('LIVE');
      expect(moderationAfterChecks('LIVE', ['PRICE_OUTLIER'])).toBe('HELD');
    });

    it('a REPP decision (hidden, rejected) is never lifted by a seller edit', () => {
      expect(moderationAfterChecks('HIDDEN', [])).toBe('HIDDEN');
      expect(moderationAfterChecks('REJECTED', [])).toBe('REJECTED');
    });
  });

  describe('legacy plans', () => {
    it('the legacy type is derived from every offer kind and maps back to a kind of the same type', () => {
      for (const kind of OFFER_KINDS) expect(LEGACY_TYPE_OF[legacyOfferKind(LEGACY_TYPE_OF[kind], 30)]).toBe(LEGACY_TYPE_OF[kind]);
    });
  });
});
