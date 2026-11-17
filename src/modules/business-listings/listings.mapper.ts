import { resolveMediaUrl, resolveMediaUrls } from '../../common/media/media-url';
import type { DirectoryEntityStatus } from '../directory/directory-entity.model';
import type { EntityPlanModel } from '../directory/models/entity-plan.model';
import type { PublicListingRow } from './public-listings.repository';

/** Why the business's own listing is or is not on the marketplace right now. */
export type ListingVisibility = 'PUBLIC' | 'BUSINESS_NOT_PUBLIC' | 'PAUSED' | 'ARCHIVED' | 'UNDER_REVIEW' | 'HIDDEN_BY_REPP' | 'REJECTED_BY_REPP';

export type OwnListingDto = {
  id: string;
  offerKind: string;
  name: string;
  description: string;
  benefits: string[];
  price: string;
  currency: string;
  validityDays: number | null;
  sessionsCount: number | null;
  stockQuantity: number | null;
  stockReserved: number;
  productCategoryId: string | null;
  displayOrder: number;
  mediaUrls: string[];
  status: string;
  moderationStatus: string;
  /** Codes the seller can act on (price band, outlier, banned terms) or REPP's reason. */
  moderationReasonCode: string | null;
  autoCheckCodes: string[];
  visibility: ListingVisibility;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function visibilityOf(listing: EntityPlanModel, entityStatus: DirectoryEntityStatus): ListingVisibility {
  if (listing.moderationStatus === 'HIDDEN') return 'HIDDEN_BY_REPP';
  if (listing.moderationStatus === 'REJECTED') return 'REJECTED_BY_REPP';
  if (listing.moderationStatus === 'HELD') return 'UNDER_REVIEW';
  if (listing.status === 'ARCHIVED') return 'ARCHIVED';
  if (listing.status === 'INACTIVE') return 'PAUSED';
  return entityStatus === 'ACTIVE' ? 'PUBLIC' : 'BUSINESS_NOT_PUBLIC';
}

const iso = (value: Date | null | undefined) => (value ? new Date(value).toISOString() : null);

export function mapOwnListing(listing: EntityPlanModel, entityStatus: DirectoryEntityStatus): OwnListingDto {
  return {
    id: listing.id,
    offerKind: listing.offerKind,
    name: listing.name,
    description: listing.description,
    benefits: listing.benefits ?? [],
    price: listing.currentPrice,
    currency: listing.currency,
    validityDays: listing.durationDays,
    sessionsCount: listing.sessionsCount,
    stockQuantity: listing.stockQuantity,
    stockReserved: listing.stockReserved,
    productCategoryId: listing.productCategoryId,
    displayOrder: listing.displayOrder,
    mediaUrls: resolveMediaUrls(listing.mediaUrls ?? []),
    status: listing.status,
    moderationStatus: listing.moderationStatus,
    moderationReasonCode: listing.moderationReasonCode,
    autoCheckCodes: listing.autoCheckCodes ?? [],
    visibility: visibilityOf(listing, entityStatus),
    publishedAt: iso(listing.publishedAt),
    createdAt: new Date(listing.createdAt).toISOString(),
    updatedAt: new Date(listing.updatedAt).toISOString(),
  };
}

/** What anyone sees of a listing: no moderation state, stock numbers, metadata, owner or tenant ids. */
export type PublicListingDto = {
  id: string;
  offerKind: string;
  name: string;
  description: string;
  benefits: string[];
  price: string;
  currency: string;
  validityDays: number | null;
  sessionsCount: number | null;
  /** Null when the seller does not track stock. */
  inStock: boolean | null;
  productCategory: { id: string; name: string; path: string } | null;
  mediaUrls: string[];
  publishedAt: string;
  seller: {
    id: string;
    name: string;
    handle: string | null;
    entityType: string;
    logoUrl: string | null;
    city: string | null;
    /** VERIFIED: a REPP moderator approved the business; NEW: approved by the automatic checks only. */
    badge: 'VERIFIED' | 'NEW';
  };
};

export function mapPublicListing(row: PublicListingRow): PublicListingDto {
  return {
    id: row.id,
    offerKind: row.offerKind,
    name: row.name,
    description: row.description,
    benefits: row.benefits ?? [],
    price: String(row.price),
    currency: row.currency,
    validityDays: row.validityDays,
    sessionsCount: row.sessionsCount,
    inStock: row.stockQuantity === null ? null : row.stockQuantity - row.stockReserved > 0,
    productCategory: row.categoryId && row.categoryName && row.categoryPath ? { id: row.categoryId, name: row.categoryName, path: row.categoryPath } : null,
    mediaUrls: resolveMediaUrls(row.mediaUrls ?? []),
    publishedAt: new Date(row.publishedAt).toISOString(),
    seller: {
      id: row.entityId,
      name: row.sellerName,
      handle: row.sellerHandle,
      entityType: row.sellerType,
      logoUrl: resolveMediaUrl(row.sellerLogoUrl),
      city: row.sellerCity,
      badge: row.sellerVerified ? 'VERIFIED' : 'NEW',
    },
  };
}
