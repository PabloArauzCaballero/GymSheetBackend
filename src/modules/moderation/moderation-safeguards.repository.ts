import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ModerationReasonValue, ModerationTargetKindValue } from "./moderation.policy";

/** A reported chat message as it was when reported. */
export interface ChatMessageEvidence {
  messageId: string;
  conversationId: string;
  senderId: string;
  type: string;
  body: string | null;
  mediaMimeType: string | null;
  locationLat: number | null;
  locationLng: number | null;
  locationLabel: string | null;
  sentAt: Date;
  editedAt: Date | null;
  capturedAt: Date;
}

/** Data access for the minor suspension, chat evidence and auto-hide review items. */
@Injectable()
export class ModerationSafeguardsRepository {
  constructor(private readonly sequelize: Sequelize) {}

  /** Sets an open-ended suspension on a member account. Returns whether a row changed. */
  async suspendMemberUntil(userId: string, until: Date, transaction: Transaction): Promise<boolean> {
    const [, affected] = await this.sequelize.query(
      `UPDATE public.usuarios SET suspended_until = :until
        WHERE id = :userId AND rol = 'CLIENTE' AND estado = 'ACTIVO'
          AND (suspended_until IS NULL OR suspended_until < :until)`,
      { type: QueryTypes.UPDATE, replacements: { userId, until }, transaction },
    );
    return Number(affected) > 0;
  }

  /**
   * Lifts the provisional suspension once no other MENOR_DE_EDAD report on the
   * person stays open, falling back to the longest strike suspension still
   * running (never shortening a sanction).
   */
  async liftProvisionalSuspension(
    userId: string,
    provisionalUntil: Date,
    exceptTarget: { kind: ModerationTargetKindValue; id: string },
    transaction: Transaction,
  ): Promise<void> {
    await this.sequelize.query(
      `UPDATE public.usuarios u
          SET suspended_until = (SELECT max(s.suspended_until) FROM moderation.user_strikes s
                                  WHERE s.user_id = u.id AND s.suspended_until > now())
        WHERE u.id = :userId AND u.suspended_until = :provisionalUntil
          AND NOT EXISTS (
            SELECT 1 FROM moderation.reports r
             WHERE r.reported_user_id = u.id AND r.reason = 'MENOR_DE_EDAD'
               AND r.status IN ('PENDIENTE', 'EN_REVISION')
               AND NOT (r.target_kind = :kind AND r.target_id = :id))`,
      {
        type: QueryTypes.UPDATE,
        replacements: { userId, provisionalUntil, kind: exceptTarget.kind, id: exceptTarget.id },
        transaction,
      },
    );
  }

  /** Copies the message once; later reports of the same message keep the first copy. */
  async captureChatMessage(messageId: string, transaction: Transaction): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO moderation.chat_message_evidence
         (message_id, conversation_id, sender_id, type, body, media_provider, media_key, media_mime_type,
          media_size_bytes, location_lat, location_lng, location_label, reply_to_id, forwarded,
          sent_at, edited_at, expires_at)
       SELECT m.id, m.conversation_id, m.sender_id, m.type, m.body, m.media_provider, m.media_key,
              m.media_mime_type, m.media_size_bytes, m.location_lat, m.location_lng, m.location_label,
              m.reply_to_id, m.forwarded, m.created_at, m.edited_at, m.expires_at
         FROM chat.messages m
        WHERE m.id = :messageId AND m.deleted_at IS NULL
       ON CONFLICT (message_id) DO NOTHING`,
      { type: QueryTypes.INSERT, replacements: { messageId }, transaction },
    );
  }

  async findChatMessageEvidence(messageId: string): Promise<ChatMessageEvidence | null> {
    const [row] = await this.sequelize.query<ChatMessageEvidence>(
      `SELECT message_id AS "messageId", conversation_id AS "conversationId", sender_id AS "senderId",
              type, body, media_mime_type AS "mediaMimeType", location_lat AS "locationLat",
              location_lng AS "locationLng", location_label AS "locationLabel", sent_at AS "sentAt",
              edited_at AS "editedAt", captured_at AS "capturedAt"
         FROM moderation.chat_message_evidence WHERE message_id = :messageId`,
      { type: QueryTypes.SELECT, replacements: { messageId } },
    );
    return row ?? null;
  }

  /**
   * Deletes up to `limit` copies whose reports are all closed and were resolved
   * before `resolvedBefore`. Returns the stored files no message references
   * any more, so the caller can release them in the same transaction.
   */
  async deleteExpiredChatEvidence(
    resolvedBefore: Date,
    limit: number,
    transaction: Transaction,
  ): Promise<{ deleted: number; orphanMedia: { messageId: string; provider: string; storageKey: string }[] }> {
    const rows = await this.sequelize.query<{ message_id: string; media_provider: string | null; media_key: string | null }>(
      `DELETE FROM moderation.chat_message_evidence e
        WHERE e.message_id IN (
          SELECT candidate.message_id FROM moderation.chat_message_evidence candidate
           WHERE NOT EXISTS (
             SELECT 1 FROM moderation.reports r
              WHERE r.target_kind = 'CHAT_MESSAGE' AND r.target_id = candidate.message_id
                AND (r.status IN ('PENDIENTE', 'EN_REVISION') OR r.resolved_at > :resolvedBefore))
           ORDER BY candidate.captured_at
           LIMIT :limit
           FOR UPDATE SKIP LOCKED)
        RETURNING e.message_id, e.media_provider, e.media_key`,
      { type: QueryTypes.SELECT, replacements: { resolvedBefore, limit }, transaction },
    );
    const withMedia = rows.filter((row) => row.media_provider && row.media_key);
    const referenced = withMedia.length === 0 ? [] : await this.sequelize.query<{ media_key: string }>(
      `SELECT DISTINCT media_key FROM chat.messages WHERE media_key IN (:keys)`,
      { type: QueryTypes.SELECT, replacements: { keys: withMedia.map((row) => row.media_key) }, transaction },
    );
    const stillUsed = new Set(referenced.map((row) => row.media_key));
    return {
      deleted: rows.length,
      orphanMedia: withMedia
        .filter((row) => !stillUsed.has(row.media_key as string))
        .map((row) => ({ messageId: row.message_id, provider: row.media_provider as string, storageKey: row.media_key as string })),
    };
  }

  /** Opens the review item of an auto-hidden content. Null when one is already open. */
  async openAutoHideReview(
    input: {
      tenantId: string;
      targetKind: ModerationTargetKindValue;
      targetId: string;
      authorUserId: string;
      reason: ModerationReasonValue;
      distinctReporters: number;
    },
    transaction: Transaction,
  ): Promise<string | null> {
    const [row] = await this.sequelize.query<{ id: string }>(
      `INSERT INTO moderation.auto_hide_reviews
         (tenant_id, target_kind, target_id, author_user_id, reason, distinct_reporters)
       VALUES (:tenantId, :targetKind, :targetId, :authorUserId, :reason, :distinctReporters)
       ON CONFLICT (target_kind, target_id) WHERE reviewed_at IS NULL DO NOTHING
       RETURNING id`,
      { type: QueryTypes.SELECT, replacements: input, transaction },
    );
    return row?.id ?? null;
  }

  /** Closes the open review item with the moderator's outcome. Returns whether there was one. */
  async closeAutoHideReview(
    target: { kind: ModerationTargetKindValue; id: string },
    moderatorUserId: string,
    restored: boolean,
    transaction: Transaction,
  ): Promise<boolean> {
    const rows = await this.sequelize.query<{ id: string }>(
      `UPDATE moderation.auto_hide_reviews
          SET reviewed_at = now(), reviewed_by_user_id = :moderatorUserId, outcome = :outcome
        WHERE target_kind = :kind AND target_id = :id AND reviewed_at IS NULL
        RETURNING id`,
      {
        type: QueryTypes.SELECT,
        replacements: { kind: target.kind, id: target.id, moderatorUserId, outcome: restored ? "RESTORED" : "KEPT_HIDDEN" },
        transaction,
      },
    );
    return rows.length > 0;
  }
}
