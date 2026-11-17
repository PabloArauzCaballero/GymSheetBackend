import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { NotificationChannel } from '../../common/enums/domain.enums';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { assertNotOwnBusiness } from '../business-kyc/kyc-review.service';
import { resolveMediaUrls } from '../../common/media/media-url';
import { NotificationService } from '../notifications/notification.service';
import { AdminListingDecisionInput, AdminListingReleaseInput, AdminListingsQuery } from './business-listings.schemas';
import { shapeViolations } from './listing-checks';
import { LISTING_CURRENCY } from './listing.catalog';
import { decodeKeyset, encodeCursor } from './keyset-cursor';
import type { ListingModerationStatus, ListingOfferKind } from '../directory/models/entity-plan.model';

type HeldRow = {
  id: string;
  entityId: string;
  ownerUserId: string | null;
  ownerEmail: string | null;
  sellerName: string;
  sellerHandle: string | null;
  offerKind: ListingOfferKind;
  name: string;
  description: string;
  benefits: string[];
  mediaUrls: string[];
  price: string;
  currency: string;
  validityDays: number | null;
  sessionsCount: number | null;
  stockQuantity: number | null;
  productCategoryId: string | null;
  moderationStatus: ListingModerationStatus;
  moderationReasonCode: string | null;
  autoCheckCodes: string[];
  updatedAt: Date;
  /** `updated_at` at full precision, for the keyset cursor. */
  cursorKey: string;
};

const SELECT = `SELECT p.id, p.entity_id AS "entityId", e.user_id AS "ownerUserId", u.email AS "ownerEmail",
       e.name AS "sellerName", h.handle AS "sellerHandle", p.offer_kind AS "offerKind", p.name,
       p.description, p.benefits, p.media_urls AS "mediaUrls",
       p.current_price AS price, p.currency, p.duration_days AS "validityDays", p.sessions_count AS "sessionsCount",
       p.stock_quantity AS "stockQuantity", p.product_category_id AS "productCategoryId",
       p.moderation_status AS "moderationStatus", p.moderation_reason_code AS "moderationReasonCode",
       p.auto_check_codes AS "autoCheckCodes", p.updated_at AS "updatedAt",
       to_char(p.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorKey"
  FROM directory.entity_plans p
  JOIN directory.entities e ON e.id = p.entity_id
  LEFT JOIN public.usuarios u ON u.id = e.user_id
  LEFT JOIN directory.handles h ON h.owner_entity_id = e.id AND h.status = 'ACTIVE'`;

/**
 * REPP's console over listings that are not public by moderation (ADR-0022):
 * the automatic checks held them, or a moderator hid or rejected them. REPP
 * releases (LIVE) or rejects; it never edits a seller's listing.
 */
@Injectable()
export class AdminListingsService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly notifications: NotificationService,
  ) {}

  async list(query: AdminListingsQuery) {
    const after = decodeKeyset(query.cursor);
    const rows = await this.sequelize.query<HeldRow>(
      `${SELECT} WHERE p.moderation_status = :status
         ${after ? 'AND (p.updated_at, p.id) > (CAST(:afterAt AS timestamptz), CAST(:afterId AS uuid))' : ''}
       ORDER BY p.updated_at ASC, p.id ASC LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { status: query.moderationStatus, limit: query.limit + 1, afterAt: after?.key ?? null, afterId: after?.id ?? null } },
    );
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      // `updatedAt` is the full-precision version stamp a release must send back (`seenUpdatedAt`).
      items: page.map(({ ownerEmail: _email, ownerUserId: _owner, cursorKey, updatedAt: _at, mediaUrls, ...row }) => ({
        ...row,
        mediaUrls: resolveMediaUrls(mediaUrls ?? []),
        price: String(row.price),
        updatedAt: cursorKey,
      })),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.cursorKey, last.id) : null,
    };
  }

  /**
   * Back to LIVE, and only the version REPP reviewed: a listing edited since
   * (a HELD one stays editable so its seller can fix it) answers
   * `409 LISTING_CHANGED_SINCE_REVIEW` and nothing is published. Only a
   * listing that meets today's shape and currency rules can be public.
   */
  async release(actor: AuthenticatedUser, listingId: string, input: AdminListingReleaseInput) {
    return this.sequelize.transaction(async (transaction) => {
      const row = await this.load(actor, listingId, transaction);
      if (row.moderationStatus === 'LIVE') throw invalidTransition(row.moderationStatus);
      // Compared by the database at full precision; the row is locked, so the stamp cannot move now.
      const [stamp] = await this.sequelize.query<{ unchanged: boolean }>(
        'SELECT updated_at = CAST(:seen AS timestamptz) AS unchanged FROM directory.entity_plans WHERE id = :listingId',
        { type: QueryTypes.SELECT, replacements: { listingId, seen: input.seenUpdatedAt }, transaction },
      );
      if (stamp?.unchanged !== true) {
        throw new DomainException(HttpStatus.CONFLICT, 'LISTING_CHANGED_SINCE_REVIEW', 'La publicación cambió desde que la revisaste; vuelve a revisarla.', {
          currentUpdatedAt: row.cursorKey,
        });
      }
      const violations = shapeViolations({ ...row, validityDays: row.validityDays });
      if (violations.length > 0 || row.currency !== LISTING_CURRENCY) {
        throw new DomainException(HttpStatus.CONFLICT, 'LISTING_NOT_PUBLISHABLE', 'La publicación no cumple los datos de su tipo; el negocio debe corregirla.', {
          violations: row.currency !== LISTING_CURRENCY ? [...violations, 'CURRENCY_NOT_BOB'] : violations,
        });
      }
      await this.apply(listingId, 'LIVE', null, actor, transaction);
      await this.notify(row, 'RELEASED', input.note ?? null, transaction);
      return { id: listingId, moderationStatus: 'LIVE' as const };
    });
  }

  async reject(actor: AuthenticatedUser, listingId: string, input: AdminListingDecisionInput) {
    return this.sequelize.transaction(async (transaction) => {
      const row = await this.load(actor, listingId, transaction);
      if (row.moderationStatus === 'REJECTED') throw invalidTransition(row.moderationStatus);
      await this.apply(listingId, 'REJECTED', input.reasonCode, actor, transaction);
      await this.notify(row, 'REJECTED', input.reasonCode, transaction);
      return { id: listingId, moderationStatus: 'REJECTED' as const, reasonCode: input.reasonCode };
    });
  }

  private async load(actor: AuthenticatedUser, listingId: string, transaction: Transaction): Promise<HeldRow> {
    const [row] = await this.sequelize.query<HeldRow>(`${SELECT} WHERE p.id = :listingId FOR UPDATE OF p`, {
      type: QueryTypes.SELECT,
      replacements: { listingId },
      transaction,
    });
    if (!row) throw new NotFoundException('Publicación no encontrada.');
    // ADR-0018 §8: nobody decides on their own business (same account or same mailbox).
    if (row.ownerUserId && row.ownerEmail) assertNotOwnBusiness(actor, { userId: row.ownerUserId, email: row.ownerEmail });
    return row;
  }

  private async apply(listingId: string, status: 'LIVE' | 'REJECTED', reasonCode: string | null, actor: AuthenticatedUser, transaction: Transaction) {
    await this.sequelize.query(
      `UPDATE directory.entity_plans
          SET moderation_status = :status, moderation_reason_code = :reasonCode,
              auto_check_codes = CASE WHEN :status = 'LIVE' THEN '{}'::text[] ELSE auto_check_codes END,
              published_at = CASE WHEN :status = 'LIVE' THEN COALESCE(published_at, now()) ELSE published_at END,
              moderated_by_user_id = :actorId, moderated_at = now(), updated_at = now()
        WHERE id = :listingId`,
      { replacements: { listingId, status, reasonCode, actorId: actor.id }, transaction },
    );
  }

  private async notify(row: HeldRow, outcome: 'RELEASED' | 'REJECTED', detail: string | null, transaction: Transaction) {
    if (!row.ownerUserId) return;
    await this.notifications.enqueueDirectMessage(
      {
        recipientUserId: row.ownerUserId,
        channel: NotificationChannel.IN_APP,
        subject: outcome === 'RELEASED' ? 'Tu publicación ya está visible' : 'REPP no aprobó tu publicación',
        body:
          outcome === 'RELEASED'
            ? `El equipo de REPP revisó «${row.name}» y ya se muestra en el marketplace.`
            : `El equipo de REPP revisó «${row.name}» y no puede mostrarse en el marketplace (motivo: ${detail ?? 'OTHER'}).`,
        deduplicationKey: `business.listing-moderation:${row.id}:${outcome}:${Date.now()}`,
        metadata: { kind: 'BUSINESS_LISTING_MODERATION', outcome, listingId: row.id, reasonCode: outcome === 'REJECTED' ? detail : null },
      },
      transaction,
    );
  }
}

function invalidTransition(status: string): DomainException {
  return new DomainException(HttpStatus.CONFLICT, 'LISTING_INVALID_TRANSITION', 'La publicación ya está en ese estado.', { moderationStatus: status });
}
