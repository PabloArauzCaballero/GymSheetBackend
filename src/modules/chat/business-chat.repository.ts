import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { BUSINESS_CONVERSATIONS_PER_DAY, businessChatBlocked, businessChatLimitReached } from "./business-chat.rules";

export type OpenedBusinessConversation = { conversationId: string; created: boolean };

/** Data access of the person ↔ business chat (ADR-0023). */
@Injectable()
export class BusinessChatRepository {
  constructor(private readonly sequelize: Sequelize) {}

  /**
   * The business account behind a listing a person may write to: the listing
   * is public (`ACTIVE`, which only the KYC sets), the account is ACTIVE and
   * its login is not closed. Anything else is "not found" for the caller.
   */
  async findOpenableBusinessUser(entityId: string): Promise<string | null> {
    const [row] = await this.sequelize.query<{ userId: string }>(
      `SELECT a.user_id AS "userId"
         FROM directory.entities e
         JOIN business.accounts a ON a.entity_id = e.id
         JOIN public.usuarios u ON u.id = a.user_id
        WHERE e.id = :entityId AND e.status = 'ACTIVE' AND a.status = 'ACTIVE'
          AND u.estado = 'ACTIVO' AND u.closed_at IS NULL`,
      { type: QueryTypes.SELECT, replacements: { entityId } },
    );
    return row?.userId ?? null;
  }

  /**
   * Finds the live conversation of the pair or opens one, serialized per
   * person so the block, the daily limit and the unique index see one
   * opening at a time. The unique index stays the database invariant.
   */
  open(personId: string, entityId: string, businessUserId: string): Promise<OpenedBusinessConversation> {
    return this.sequelize.transaction(async (transaction) => {
      await this.lockPerson(personId, transaction);
      const [blocked] = await this.select<{ found: number }>(
        `SELECT 1 AS found FROM chat.business_blocks WHERE business_entity_id = :entityId AND person_user_id = :personId`,
        { entityId, personId },
        transaction,
      );
      if (blocked) throw businessChatBlocked();
      const existing = await this.findLive(personId, entityId, transaction);
      if (existing) return { conversationId: existing, created: false };
      const [{ opened }] = await this.select<{ opened: number }>(
        `SELECT count(*)::int AS opened FROM chat.conversations
          WHERE kind = 'BUSINESS' AND person_user_id = :personId AND created_at > now() - interval '24 hours'`,
        { personId },
        transaction,
      );
      if (opened >= BUSINESS_CONVERSATIONS_PER_DAY) throw businessChatLimitReached();
      const [{ id }] = await this.select<{ id: string }>(
        `INSERT INTO chat.conversations (kind, business_entity_id, person_user_id)
         VALUES ('BUSINESS', :entityId, :personId) RETURNING id`,
        { entityId, personId },
        transaction,
      );
      await this.sequelize.query(
        `INSERT INTO chat.participants (conversation_id, user_id, joined_at, can_write)
         VALUES (:id, :personId, now(), true), (:id, :businessUserId, now(), true)`,
        { replacements: { id, personId, businessUserId }, transaction },
      );
      return { conversationId: id, created: true };
    });
  }

  async findLive(personId: string, entityId: string, transaction?: Transaction): Promise<string | null> {
    const [row] = await this.select<{ id: string }>(
      `SELECT id FROM chat.conversations
        WHERE kind = 'BUSINESS' AND business_entity_id = :entityId AND person_user_id = :personId AND revoked_at IS NULL`,
      { entityId, personId },
      transaction,
    );
    return row?.id ?? null;
  }

  /**
   * The business blocks the person of one of ITS conversations: the block is
   * recorded and the conversation revoked. `null` when the conversation is not
   * a BUSINESS conversation of this listing (the caller answers 404).
   * Idempotent: blocking again leaves the same state.
   */
  block(conversationId: string, entityId: string, businessUserId: string): Promise<{ revoked: boolean } | null> {
    return this.sequelize.transaction(async (transaction) => {
      const [conversation] = await this.select<{ personId: string }>(
        `SELECT c.person_user_id AS "personId"
           FROM chat.conversations c
           JOIN chat.participants p ON p.conversation_id = c.id AND p.user_id = :businessUserId
          WHERE c.id = :conversationId AND c.kind = 'BUSINESS' AND c.business_entity_id = :entityId`,
        { conversationId, entityId, businessUserId },
        transaction,
      );
      if (!conversation) return null;
      await this.lockPerson(conversation.personId, transaction);
      await this.sequelize.query(
        `INSERT INTO chat.business_blocks (business_entity_id, person_user_id, blocked_by_user_id, conversation_id)
         VALUES (:entityId, :personId, :businessUserId, :conversationId)
         ON CONFLICT (business_entity_id, person_user_id) DO NOTHING`,
        { replacements: { entityId, personId: conversation.personId, businessUserId, conversationId }, transaction },
      );
      const revoked = await this.select<{ id: string }>(
        `UPDATE chat.conversations SET revoked_at = now(), revoked_by_user_id = :businessUserId
          WHERE id = :conversationId AND revoked_at IS NULL RETURNING id`,
        { conversationId, businessUserId },
        transaction,
      );
      return { revoked: revoked.length > 0 };
    });
  }

  /** Advisory, not a row lock: it never interleaves with the user-row locks of read receipts. */
  private async lockPerson(personId: string, transaction: Transaction): Promise<void> {
    await this.sequelize.query(`SELECT pg_advisory_xact_lock(hashtext('business-chat:' || :personId))`, {
      replacements: { personId },
      transaction,
    });
  }

  private select<T extends object>(sql: string, replacements: Record<string, unknown>, transaction?: Transaction): Promise<T[]> {
    return this.sequelize.query<T>(sql, { type: QueryTypes.SELECT, replacements, ...(transaction ? { transaction } : {}) });
  }
}
