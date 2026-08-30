import { Injectable } from "@nestjs/common";
import { env } from "../../config/env";
import { UsersRepository } from "../users/users.repository";
import { ChatRepository, SystemConversationKind } from "./chat.repository";

/**
 * Resuelve y garantiza los chats de sistema fijos de cada usuario: soporte
 * corporativo (una cuenta global) y el admin de su tenant (una cuenta real,
 * resuelta dinámicamente — no hay una fila "el admin" por tenant en el
 * esquema). Ninguno de los dos es obligatorio: sin cuenta corporativa
 * sembrada, o sin un `ADMIN` activo en el tenant, ese chat simplemente no se
 * crea para nadie.
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

  private async resolveTenantAdminUserId(tenantId: string): Promise<string | null> {
    const admin = await this.usersRepository.findAdminForTenant(tenantId);
    return admin?.id ?? null;
  }

  /**
   * Idempotente: si la conversación con esa cuenta de sistema ya existe (es
   * un chat 1:1 normal a nivel de esquema), no crea una segunda.
   */
  private async ensureConversationWith(
    userId: string,
    systemUserId: string | null,
    systemKind: SystemConversationKind,
  ): Promise<void> {
    if (!systemUserId || systemUserId === userId) return;
    const existing = await this.chatRepository.findDirectConversation(userId, systemUserId);
    if (existing) return;
    await this.chatRepository.createSystemConversation(userId, systemUserId, systemKind);
  }

  async ensureSystemConversations(userId: string, tenantId: string): Promise<void> {
    const [corporateUserId, tenantAdminUserId] = await Promise.all([
      this.resolveCorporateUserId(),
      this.resolveTenantAdminUserId(tenantId),
    ]);
    await Promise.all([
      this.ensureConversationWith(userId, corporateUserId, "CORPORATE"),
      this.ensureConversationWith(userId, tenantAdminUserId, "TENANT_ADMIN"),
    ]);
  }
}
