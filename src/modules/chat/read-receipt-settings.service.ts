import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import type { ReadReceiptSettingsQuery, UpdateReadReceiptSettingsInput } from "./chat.schemas";
import { applyReadReceiptCommand } from "./read-receipt-policy";
import { ChatRepository } from "./chat.repository";
import { ChatEventsService } from "./chat-events.service";

type SettingsRow = { enabled: boolean; version: number };
type OverrideRow = { read_receipts_enabled: boolean | null };

@Injectable()
export class ReadReceiptSettingsService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly chatRepository: ChatRepository,
    private readonly chatEvents: ChatEventsService,
  ) {}

  async get(userId: string, query: ReadReceiptSettingsQuery) {
    const settings = await this.readSettings(userId);
    let override: boolean | null = null;
    if (query.conversationId) {
      const rows = await this.sequelize.query<OverrideRow>(
        `SELECT read_receipts_enabled FROM chat.participants WHERE user_id = :userId AND conversation_id = :conversationId`,
        { type: QueryTypes.SELECT, replacements: { userId, conversationId: query.conversationId } },
      );
      if (!rows.length) throw new NotFoundException("Conversación no encontrada.");
      override = rows[0].read_receipts_enabled;
    }
    return {
      enabled: override ?? settings.enabled,
      defaultEnabled: settings.enabled,
      conversationOverride: override,
      version: settings.version,
    };
  }

  async update(userId: string, input: UpdateReadReceiptSettingsInput) {
    const result = await this.sequelize.transaction(async (transaction) => {
      // Lock an existing user row so concurrent settings writes serialize even
      // when the preference row has not been created yet.
      const users = await this.sequelize.query<{ id: string }>(
        `SELECT id FROM public.usuarios WHERE id = :userId FOR UPDATE`,
        { type: QueryTypes.SELECT, replacements: { userId }, transaction },
      );
      if (!users.length) throw new NotFoundException("Usuario no encontrado.");

      await this.sequelize.query(
        `INSERT INTO chat.read_receipt_settings (user_id, enabled, version)
         VALUES (:userId, true, 0) ON CONFLICT (user_id) DO NOTHING`,
        { replacements: { userId }, transaction },
      );
      const current = await this.readSettings(userId, transaction);
      let next: ReturnType<typeof applyReadReceiptCommand>;
      try {
        next = applyReadReceiptCommand({ ...current, overrides: {} }, input);
      } catch (error) {
        if (error instanceof Error && error.message === "READ_RECEIPT_VERSION_CONFLICT") {
          throw new ConflictException("Las preferencias de lectura cambiaron. Recarga e intenta otra vez.");
        }
        throw error;
      }

      if (input.scope === "ALL") {
        await this.sequelize.query(
          `UPDATE chat.participants
              SET read_receipts_enabled = NULL, read_receipts_enabled_since = NULL
            WHERE user_id = :userId`,
          { replacements: { userId }, transaction },
        );
      } else {
        const conversationIds = input.scope === "CONVERSATION" ? [input.conversationId] : input.conversationIds;
        const rows = await this.sequelize.query<{ conversation_id: string }>(
          `SELECT conversation_id FROM chat.participants
            WHERE user_id = :userId AND conversation_id IN (:conversationIds) FOR UPDATE`,
          { type: QueryTypes.SELECT, replacements: { userId, conversationIds }, transaction },
        );
        if (rows.length !== new Set(conversationIds).size) throw new NotFoundException("Conversación no encontrada.");
        await this.sequelize.query(
          `UPDATE chat.participants
              SET read_receipts_enabled = :enabled,
                  read_receipts_enabled_since = CASE WHEN :enabled THEN NOW() ELSE NULL END
            WHERE user_id = :userId AND conversation_id IN (:conversationIds)`,
          { replacements: { userId, enabled: input.enabled, conversationIds }, transaction },
        );
      }

      await this.sequelize.query(
        `UPDATE chat.read_receipt_settings
            SET enabled = :enabled,
                enabled_since = CASE
                  WHEN :globalScope THEN CASE WHEN :enabled THEN NOW() ELSE NULL END
                  ELSE enabled_since
                END,
                version = version + 1
          WHERE user_id = :userId`,
        { replacements: { userId, enabled: next.enabled, globalScope: input.scope === "ALL" }, transaction },
      );
      return {
        enabled: input.scope === "CONVERSATION" ? input.enabled : next.enabled,
        defaultEnabled: next.enabled,
        conversationOverride: input.scope === "CONVERSATION" ? input.enabled : null,
        version: next.version,
      };
    });
    const conversationIds = input.scope === "ALL"
      ? await this.chatRepository.conversationIdsForUser(userId)
      : input.scope === "CONVERSATION" ? [input.conversationId] : input.conversationIds;
    for (const conversationId of conversationIds) {
      this.chatEvents.emitReadReceiptSettingsChanged(conversationId, userId, result.version);
    }
    return result;
  }

  private async readSettings(userId: string, transaction?: Transaction): Promise<SettingsRow> {
    const rows = await this.sequelize.query<SettingsRow>(
      `SELECT enabled, version FROM chat.read_receipt_settings WHERE user_id = :userId`,
      { type: QueryTypes.SELECT, replacements: { userId }, ...(transaction ? { transaction } : {}) },
    );
    return rows[0] ?? { enabled: true, version: 0 };
  }
}
