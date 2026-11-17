import { Injectable } from "@nestjs/common";
import { env } from "../../config/env";
import { UsersRepository } from "../users/users.repository";
import { ChatRepository } from "./chat.repository";

/**
 * Ensures each member's fixed system chat: REPP's corporate support (one
 * global account). It is optional: without a seeded corporate account it is
 * simply not created. The gym admin chat is gone (ADR-0019): REPP operates the
 * platform and the gym has no staff to talk to.
 */
@Injectable()
export class SystemChatService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly chatRepository: ChatRepository,
  ) {}

  private async resolveCorporateUserId(): Promise<string | null> {
    if (!env.SEED_SYSTEM_CORPORATE_EMAIL) return null;
    const account = await this.usersRepository.findActiveByEmail(env.SEED_SYSTEM_CORPORATE_EMAIL);
    return account?.id ?? null;
  }

  /**
   * Idempotent: if the conversation with the corporate account already exists
   * (a regular 1:1 chat at schema level), no second one is created.
   */
  async ensureSystemConversations(userId: string): Promise<void> {
    const corporateUserId = await this.resolveCorporateUserId();
    if (!corporateUserId || corporateUserId === userId) return;
    const existing = await this.chatRepository.findDirectConversation(userId, corporateUserId);
    if (existing) return;
    await this.chatRepository.createSystemConversation(userId, corporateUserId, "CORPORATE");
  }
}
