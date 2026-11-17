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

/** A disputed order (ADR-0024): amounts, statuses and the receipt's fingerprint, never the file itself. */
export type OrderContentRow = {
  orderNumber: string;
  status: string;
  method: string;
  quantity: number;
  unitAmount: string;
  amount: string;
  currency: string;
  planSnapshot: Record<string, unknown> | null;
  buyerNote: string | null;
  receiptReference: string | null;
  receiptSha256: string | null;
  receiptAttempts: number;
  rejectionCode: string | null;
  rejectionReason: string | null;
  cancelReason: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  decidedAt: Date | null;
  entityId: string;
  sellerName: string;
  sellerHandle: string | null;
  sellerStatus: string;
  sellerVerified: boolean;
  holderMatch: string | null;
  timeline: { status: string; at: string; reasonCode: string | null }[] | null;
};

export const ORDER_CONTENT_SQL = `
  SELECT o.order_number AS "orderNumber", o.status, o.method, o.quantity, o.unit_amount AS "unitAmount", o.amount, o.currency,
         o.plan_snapshot AS "planSnapshot", o.athlete_notes AS "buyerNote", o.receipt_reference AS "receiptReference",
         o.receipt_sha256 AS "receiptSha256", o.receipt_attempts AS "receiptAttempts", o.rejection_code AS "rejectionCode",
         o.rejection_reason AS "rejectionReason", o.cancel_reason AS "cancelReason", o.created_at AS "createdAt",
         o.submitted_at AS "submittedAt", o.decided_at AS "decidedAt", e.id AS "entityId", e.name AS "sellerName",
         h.handle AS "sellerHandle", e.status AS "sellerStatus", e.is_verified AS "sellerVerified", c.holder_match AS "holderMatch",
         (SELECT json_agg(json_build_object('status', t.to_status, 'at', t.at, 'reasonCode', t.reason_code) ORDER BY t.at, t.id)
            FROM directory.payment_order_history t WHERE t.order_id = o.id) AS timeline
    FROM directory.payment_orders o
    JOIN directory.entities e ON e.id = o.entity_id
    LEFT JOIN directory.handles h ON h.owner_entity_id = e.id AND h.status = 'ACTIVE'
    LEFT JOIN directory.entity_payment_configs c ON c.entity_id = e.id
   WHERE o.id = :targetId`;

export type OrderCaseContent = {
  kind: "PAYMENT_ORDER";
  orderNumber: string;
  status: string;
  method: string;
  quantity: number;
  unitAmount: string;
  amount: string;
  currency: string;
  listingName: string | null;
  buyerNote: string | null;
  receipt: { uploaded: boolean; sha256: string | null; reference: string | null; attempts: number; path: string | null };
  rejection: { code: string; note: string | null } | null;
  cancelReason: string | null;
  createdAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  seller: { entityId: string; name: string; handle: string | null; status: string; isVerified: boolean; holderMatch: string | null };
  timeline: { status: string; at: string; reasonCode: string | null }[];
};

export function mapOrderContent(targetId: string, row: OrderContentRow): BusinessCaseContent {
  const name = row.planSnapshot?.name;
  return {
    kind: "PAYMENT_ORDER",
    orderNumber: row.orderNumber,
    status: row.status,
    method: row.method,
    quantity: row.quantity,
    unitAmount: String(row.unitAmount),
    amount: String(row.amount),
    currency: row.currency.trim(),
    listingName: typeof name === "string" ? name : null,
    buyerNote: row.buyerNote,
    receipt: {
      uploaded: row.receiptSha256 !== null,
      sha256: row.receiptSha256,
      reference: row.receiptReference,
      attempts: row.receiptAttempts,
      // Viewable only through the case, audited (AdminOrderEvidenceController).
      path: row.receiptSha256 ? `/admin/moderation/cases/PAYMENT_ORDER/${targetId}/receipt` : null,
    },
    rejection: row.rejectionCode ? { code: row.rejectionCode, note: row.rejectionReason } : null,
    cancelReason: row.cancelReason,
    createdAt: new Date(row.createdAt).toISOString(),
    submittedAt: row.submittedAt ? new Date(row.submittedAt).toISOString() : null,
    decidedAt: row.decidedAt ? new Date(row.decidedAt).toISOString() : null,
    seller: { entityId: row.entityId, name: row.sellerName, handle: row.sellerHandle, status: row.sellerStatus, isVerified: row.sellerVerified, holderMatch: row.holderMatch },
    timeline: (row.timeline ?? []).map((entry) => ({ status: entry.status, at: new Date(entry.at).toISOString(), reasonCode: entry.reasonCode })),
  };
}

export type BusinessCaseContent =
  | OrderCaseContent
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
