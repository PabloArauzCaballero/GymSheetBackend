import { mapPublicListing } from './listings.mapper';
import type { PublicListingRow } from './public-listings.repository';

const row: PublicListingRow = {
  id: 'listing-1',
  offerKind: 'PRODUCT',
  name: 'Proteína 2 kg',
  description: 'Sabor vainilla',
  benefits: [],
  price: '350.00',
  currency: 'BOB',
  validityDays: null,
  sessionsCount: null,
  stockQuantity: 3,
  stockReserved: 3,
  categoryId: null,
  categoryName: null,
  categoryPath: null,
  mediaUrls: [],
  publishedAt: new Date('2026-11-16T10:00:00Z'),
  publishedKey: '2026-11-16T10:00:00.000000Z',
  entityId: 'entity-1',
  sellerName: 'Tienda',
  sellerHandle: 'tienda',
  sellerType: 'STORE',
  sellerLogoUrl: null,
  sellerCity: 'La Paz',
  sellerVerified: false,
};

describe('public listing mapper (ADR-0022)', () => {
  it('never exposes the moderation state, stock numbers, metadata, owner or tenant', () => {
    const dto = mapPublicListing(row) as unknown as Record<string, unknown>;
    for (const field of ['moderationStatus', 'moderationReasonCode', 'autoCheckCodes', 'stockQuantity', 'stockReserved', 'metadata', 'userId', 'tenantId', 'publishedKey', 'status']) {
      expect(dto).not.toHaveProperty(field);
    }
    expect(Object.keys(dto.seller as object).sort()).toEqual(['badge', 'city', 'entityType', 'handle', 'id', 'logoUrl', 'name']);
  });

  it('stock becomes in-stock or not, and the badge tells REPP-verified from automatically approved', () => {
    expect(mapPublicListing(row)).toMatchObject({ inStock: false, seller: { badge: 'NEW' } });
    expect(mapPublicListing({ ...row, stockReserved: 1, sellerVerified: true })).toMatchObject({ inStock: true, seller: { badge: 'VERIFIED' } });
    expect(mapPublicListing({ ...row, stockQuantity: null })).toMatchObject({ inStock: null });
  });
});
