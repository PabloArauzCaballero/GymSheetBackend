import { resolveMediaUrl, resolveMediaUrls } from "../../common/media/media-url";

/**
 * Case content of the marketplace targets (ADR-0018 §9 for ADR-0022): what the
 * moderator reads of a reported listing or business profile, whatever its
 * moderation state. Plain rows only; no seller contact, account or tenant ids.
 */
export type ListingContentRow = {
  name: string;
  description: string;
  benefits: string[] | null;
  offerKind: string;
  price: string;
  currency: string;
  validityDays: number | null;
  sessionsCount: number | null;
  mediaUrls: string[] | null;
  status: string;
  moderationStatus: string;
  entityId: string;
  sellerName: string;
  sellerHandle: string | null;
};
export type ProfileContentRow = {
  name: string;
  entityType: string;
  headline: string | null;
  description: string;
  logoUrl: string | null;
  coverUrl: string | null;
  gallery: string[] | null;
  city: string | null;
  status: string;
  isVerified: boolean;
  handle: string | null;
};

export const LISTING_CONTENT_SQL = `
  SELECT p.name, p.description, p.benefits, p.offer_kind AS "offerKind", p.current_price AS price, p.currency,
         p.duration_days AS "validityDays", p.sessions_count AS "sessionsCount", p.media_urls AS "mediaUrls",
         p.status, p.moderation_status AS "moderationStatus", e.id AS "entityId", e.name AS "sellerName", h.handle AS "sellerHandle"
    FROM directory.entity_plans p
    JOIN directory.entities e ON e.id = p.entity_id
    LEFT JOIN directory.handles h ON h.owner_entity_id = e.id AND h.status = 'ACTIVE'
   WHERE p.id = :targetId`;

export const PROFILE_CONTENT_SQL = `
  SELECT e.name, e.entity_type AS "entityType", e.headline, e.description, e.logo_url AS "logoUrl", e.cover_url AS "coverUrl",
         e.gallery, e.city, e.status, e.is_verified AS "isVerified", h.handle
    FROM directory.entities e
    LEFT JOIN directory.handles h ON h.owner_entity_id = e.id AND h.status = 'ACTIVE'
   WHERE e.id = :targetId`;

export type BusinessCaseContent =
  | {
      kind: "BUSINESS_LISTING";
      name: string;
      description: string;
      benefits: string[];
      offerKind: string;
      price: string;
      currency: string;
      validityDays: number | null;
      sessionsCount: number | null;
      mediaUrls: string[];
      status: string;
      moderationStatus: string;
      seller: { entityId: string; name: string; handle: string | null };
    }
  | {
      kind: "BUSINESS_PROFILE";
      name: string;
      entityType: string;
      headline: string | null;
      description: string;
      logoUrl: string | null;
      coverUrl: string | null;
      gallery: string[];
      city: string | null;
      status: string;
      isVerified: boolean;
      handle: string | null;
    };

export function mapListingContent(row: ListingContentRow): BusinessCaseContent {
  return {
    kind: "BUSINESS_LISTING",
    name: row.name,
    description: row.description,
    benefits: row.benefits ?? [],
    offerKind: row.offerKind,
    price: String(row.price),
    currency: row.currency,
    validityDays: row.validityDays,
    sessionsCount: row.sessionsCount,
    mediaUrls: resolveMediaUrls(row.mediaUrls ?? []),
    status: row.status,
    moderationStatus: row.moderationStatus,
    seller: { entityId: row.entityId, name: row.sellerName, handle: row.sellerHandle },
  };
}

export function mapProfileContent(row: ProfileContentRow): BusinessCaseContent {
  return {
    kind: "BUSINESS_PROFILE",
    name: row.name,
    entityType: row.entityType,
    headline: row.headline,
    description: row.description,
    logoUrl: resolveMediaUrl(row.logoUrl),
    coverUrl: resolveMediaUrl(row.coverUrl),
    gallery: resolveMediaUrls(row.gallery ?? []),
    city: row.city,
    status: row.status,
    isVerified: row.isVerified,
    handle: row.handle,
  };
}
