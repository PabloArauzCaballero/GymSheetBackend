import { Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { PublicListingsQuery } from './business-listings.schemas';

/** One public listing with its seller, as the search reads it (plain row, never an ORM model). */
export type PublicListingRow = {
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
  categoryId: string | null;
  categoryName: string | null;
  categoryPath: string | null;
  mediaUrls: string[];
  publishedAt: Date;
  /** `published_at` at full precision, for the keyset cursor. */
  publishedKey: string;
  entityId: string;
  sellerName: string;
  sellerHandle: string | null;
  sellerType: string;
  sellerLogoUrl: string | null;
  sellerCity: string | null;
  sellerVerified: boolean;
};

export type SearchKeyset = { kind: 'recent'; at: string; id: string } | { kind: 'price'; price: string; id: string };

/**
 * The public marketplace reads only LIVE + ACTIVE listings of ACTIVE sellers.
 * That predicate is the single definition of "public" (`PUBLIC_LISTING_SQL`):
 * a suspended, paused, draft or closed seller takes every listing with it, and
 * a held, hidden or rejected listing is never served (plan D7, ADR-0022).
 */
export const PUBLIC_LISTING_SQL = `p.moderation_status = 'LIVE' AND p.status = 'ACTIVE' AND e.status = 'ACTIVE'`;

const SELECT = `
  SELECT p.id, p.offer_kind AS "offerKind", p.name, p.description, p.benefits, p.current_price AS price, p.currency,
         p.duration_days AS "validityDays", p.sessions_count AS "sessionsCount",
         p.stock_quantity AS "stockQuantity", p.stock_reserved AS "stockReserved",
         c.id AS "categoryId", c.name AS "categoryName", c.path AS "categoryPath",
         p.media_urls AS "mediaUrls", p.published_at AS "publishedAt", to_char(p.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "publishedKey",
         e.id AS "entityId", e.name AS "sellerName", h.handle AS "sellerHandle", e.entity_type AS "sellerType",
         e.logo_url AS "sellerLogoUrl", e.city AS "sellerCity", e.is_verified AS "sellerVerified"
    FROM directory.entity_plans p
    JOIN directory.entities e ON e.id = p.entity_id
    LEFT JOIN directory.handles h ON h.owner_entity_id = e.id AND h.status = 'ACTIVE'
    LEFT JOIN directory.categories c ON c.id = p.product_category_id`;

const ORDER = {
  recent: { orderBy: 'p.published_at DESC, p.id DESC', after: `(p.published_at, p.id) < (CAST(:afterAt AS timestamptz), CAST(:afterId AS uuid))` },
  price_asc: { orderBy: 'p.current_price ASC, p.id ASC', after: `(p.current_price, p.id) > (CAST(:afterPrice AS numeric), CAST(:afterId AS uuid))` },
  price_desc: { orderBy: 'p.current_price DESC, p.id DESC', after: `(p.current_price, p.id) < (CAST(:afterPrice AS numeric), CAST(:afterId AS uuid))` },
} as const;

@Injectable()
export class PublicListingsRepository {
  constructor(private readonly sequelize: Sequelize) {}

  /**
   * Keyset-paginated search (never OFFSET, never in memory). Every filter is a
   * bound parameter; the free text is normalized by `repp_normalize` on the
   * database side, which leaves only `[a-z0-9 ]`, so it cannot inject a LIKE
   * wildcard, and the trigram index `ix_entity_plans_public_name_trgm` serves it.
   */
  search(query: PublicListingsQuery, after: SearchKeyset | null, limit: number): Promise<PublicListingRow[]> {
    const where: string[] = [PUBLIC_LISTING_SQL];
    const replacements: Record<string, unknown> = { limit };
    const add = (clause: string, values: Record<string, unknown>) => {
      where.push(clause);
      Object.assign(replacements, values);
    };
    const handle = query.q?.startsWith('@') ? query.q.slice(1).toLowerCase() : null;
    if (handle) add('h.handle = :handle', { handle });
    else if (query.q) add(`public.repp_normalize(p.name) LIKE '%' || public.repp_normalize(:q) || '%'`, { q: query.q });
    if (query.offer_kind) add('p.offer_kind = :offerKind', { offerKind: query.offer_kind });
    if (query.entity_type) add('e.entity_type = :entityType', { entityType: query.entity_type });
    if (query.entity_id) add('e.id = :entityId', { entityId: query.entity_id });
    if (query.city) add('lower(e.city) = lower(:city)', { city: query.city });
    if (query.price_min !== undefined) add('p.current_price >= :priceMin', { priceMin: query.price_min });
    if (query.price_max !== undefined) add('p.current_price <= :priceMax', { priceMax: query.price_max });
    if (query.verified_only) add('e.is_verified', {});
    if (query.category_path) {
      // The product's own category, or the seller's for plans, passes and services.
      add(
        `EXISTS (SELECT 1 FROM directory.categories k WHERE k.id = COALESCE(p.product_category_id, e.primary_category_id)
                   AND (k.path = :categoryPath OR k.path LIKE :categoryPath || '.%'))`,
        { categoryPath: query.category_path },
      );
    }
    const order = ORDER[query.sort];
    if (after?.kind === 'recent') add(order.after, { afterAt: after.at, afterId: after.id });
    if (after?.kind === 'price') add(order.after, { afterPrice: after.price, afterId: after.id });
    return this.sequelize.query<PublicListingRow>(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order.orderBy} LIMIT :limit`, {
      type: QueryTypes.SELECT,
      replacements,
    });
  }

  async findPublic(listingId: string): Promise<PublicListingRow | null> {
    const [row] = await this.sequelize.query<PublicListingRow>(`${SELECT} WHERE p.id = :listingId AND ${PUBLIC_LISTING_SQL}`, {
      type: QueryTypes.SELECT,
      replacements: { listingId },
    });
    return row ?? null;
  }
}
