import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Transaction } from "sequelize";
import {
  ConnectionStatus,
  NotificationChannel,
  UserRole,
} from "../../common/enums/domain.enums";
import { env } from "../../config/env";
import type { ChatRepository } from "../chat/chat.repository";
import type { NotificationService } from "../notifications/notification.service";
import type { UserModel } from "../users/user.model";
import type { UsersRepository } from "../users/users.repository";
import type { ConnectionModel } from "./connection.model";
import type { SocialRepository } from "./social.repository";

export interface LikeOutcome {
  connection: ConnectionModel;
  matched: boolean;
  target: UserModel;
}

interface SocialMatchDependencies {
  repository: SocialRepository;
  usersRepository: UsersRepository;
  /** Getters: both are optional and the chat one is a forward reference. */
  notifications: () => NotificationService | undefined;
  chatRepository: () => ChatRepository | undefined;
}

/**
 * The single match model (F5.01): a LIKE is a connection request, and a LIKE
 * toward someone whose LIKE is pending is the match — the connection becomes
 * ACCEPTED, the direct conversation exists and the other person is notified.
 * Every entry point (deck swipe, directory/map "connect", accepting from the
 * likes panel) goes through `like`, so all of them produce the same result.
 */
export class SocialMatchFlow {
  constructor(private readonly deps: SocialMatchDependencies) {}

  /**
   * Must run inside the caller's transaction (pair lock + atomic write).
   * `loaded` is the pair's active connection when the caller already read it
   * under the pair lock (accepting from the likes panel).
   */
  async like(
    actorId: string,
    actorTenantId: string,
    targetId: string,
    transaction: Transaction,
    loaded?: ConnectionModel,
  ): Promise<LikeOutcome> {
    const { repository, usersRepository } = this.deps;
    if (actorId === targetId) {
      throw new BadRequestException("No puedes enviarte una solicitud a ti mismo.");
    }
    await repository.lockSocialPair(actorId, targetId, transaction);
    if (await repository.isBlockedEitherWay(actorId, targetId, transaction)) {
      throw new NotFoundException("Usuario no encontrado.");
    }
    const target = await usersRepository.findActiveById(targetId, transaction);
    // A business account is not a person one connects with (ADR-0020).
    if (!target || target.role === UserRole.BUSINESS) throw new NotFoundException("Usuario no encontrado.");
    if (
      (target.tenantId ?? env.DEFAULT_TENANT_ID) !== actorTenantId &&
      !(await repository.canInteractAcrossTenants(actorId, targetId, transaction))
    ) {
      throw new NotFoundException("Usuario no encontrado.");
    }

    // A like overrides an earlier pass: undoing the like must not leave the
    // card hidden from the deck without any connection.
    await repository.deletePass(actorId, targetId, transaction);
    const existing = loaded ?? (await repository.findActiveBetween(actorId, targetId, transaction));
    if (!existing) {
      const created = await repository.create(actorId, targetId, transaction);
      return { connection: created, matched: false, target };
    }
    if (existing.status === ConnectionStatus.PENDING && existing.requesterId === targetId) {
      return { connection: await this.accept(existing, transaction), matched: true, target };
    }
    throw new ConflictException(
      existing.status === ConnectionStatus.ACCEPTED
        ? "Ya están conectados."
        : "Ya existe una solicitud pendiente entre ustedes.",
    );
  }

  private async accept(
    pending: ConnectionModel,
    transaction: Transaction,
  ): Promise<ConnectionModel> {
    const accepted = await this.deps.repository.respond(
      pending,
      ConnectionStatus.ACCEPTED,
      transaction,
    );
    await this.deps.chatRepository()?.ensureDirectConversationInTransaction(
      pending.requesterId,
      pending.addresseeId,
      transaction,
    );
    await this.deps.notifications()?.enqueueDirectMessage(
      {
        recipientUserId: pending.requesterId,
        channel: NotificationChannel.IN_APP,
        subject: "Solicitud de conexión aceptada",
        body: "Tu solicitud de conexión fue aceptada.",
        deduplicationKey: `connection.accepted:${pending.id}:${pending.requesterId}`,
        metadata: { kind: "CONNECTION_ACCEPTED", connectionId: pending.id },
      },
      transaction,
    );
    return accepted;
  }
}
