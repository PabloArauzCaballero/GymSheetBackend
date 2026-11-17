import { Injectable, NotFoundException } from "@nestjs/common";
import { UniqueConstraintError } from "sequelize";
import { BusinessChatRepository, OpenedBusinessConversation } from "./business-chat.repository";
import { ChatEventsService } from "./chat-events.service";

const NOT_FOUND = "No encontramos ese negocio.";

/**
 * A person writes to a business; the business only answers (ADR-0023). The
 * conversation then lives in `/me/conversations` for both sides, with the
 * same participants, encrypted media, push and read receipts as any chat.
 */
@Injectable()
export class BusinessChatService {
  constructor(
    private readonly repository: BusinessChatRepository,
    private readonly chatEvents: ChatEventsService,
  ) {}

  /**
   * Opens (or returns) the person's conversation with a public listing. No
   * social connection is needed. A listing that is not public answers 404
   * whatever the reason, so its state cannot be probed.
   */
  async open(personId: string, entityId: string): Promise<OpenedBusinessConversation> {
    const businessUserId = await this.repository.findOpenableBusinessUser(entityId);
    if (!businessUserId || businessUserId === personId) throw new NotFoundException(NOT_FOUND);
    try {
      return await this.repository.open(personId, entityId, businessUserId);
    } catch (error: unknown) {
      // Another opening of the same pair won the unique index: return its conversation.
      if (!(error instanceof UniqueConstraintError)) throw error;
      const existing = await this.repository.findLive(personId, entityId);
      if (!existing) throw error;
      return { conversationId: existing, created: false };
    }
  }

  /** The business blocks the person of one of its conversations; anything else is 404. */
  async block(conversationId: string, business: { userId: string; entityId: string | null }): Promise<{ conversationId: string; blocked: true }> {
    const result = business.entityId ? await this.repository.block(conversationId, business.entityId, business.userId) : null;
    if (!result) throw new NotFoundException("Conversación no encontrada.");
    if (result.revoked) this.chatEvents.emitConversationRevoked(conversationId);
    return { conversationId, blocked: true };
  }
}
