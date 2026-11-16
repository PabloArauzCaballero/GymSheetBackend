import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";

/**
 * Whether moderation keeps an evidence copy of a message. Read here with SQL
 * (as the purge reads `moderation.reports`) so the chat module does not depend
 * on the moderation module, which already depends on chat.
 */
@Injectable()
export class MessageEvidenceHoldRepository {
  constructor(private readonly sequelize: Sequelize) {}

  async isHeld(messageId: string, transaction: Transaction): Promise<boolean> {
    const rows = await this.sequelize.query<{ held: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM moderation.chat_message_evidence WHERE message_id = :messageId) AS held`,
      { type: QueryTypes.SELECT, replacements: { messageId }, transaction },
    );
    return rows[0]?.held === true;
  }
}
