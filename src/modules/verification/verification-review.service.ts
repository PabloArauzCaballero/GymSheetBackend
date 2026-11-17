import { ForbiddenException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { NotificationChannel, UserRole } from "../../common/enums/domain.enums";
import { DomainException } from "../../common/errors/domain.exception";
import { platformScopeOf } from "../../common/tenancy/tenant-scope";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
import { ChatMediaCipher } from "../chat/chat-media-cipher";
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from "../media/media-storage.port";
import { caseRefusalFor, CaseRefusalCode } from "../moderation/moderation.policy";
import { NotificationService } from "../notifications/notification.service";
import { PhotoVerificationModel } from "./photo-verification.model";
import { SelfieLinkSigner } from "./selfie-link.signer";
import { VERIFICATION_REJECTION_REASONS, VerificationStatus } from "./verification.catalog";
import { mapQueueItem, QueueItemResponse, SubmissionResponse, mapSubmission } from "./verification.mapper";
import { assertTransition, VERIFICATION_CLOCK, VERIFICATION_RULES, VerificationClock } from "./verification.policy";
import { VerificationRepository } from "./verification.repository";
import { DecideVerificationInput, SelfieLinkQuery, VerificationQueueQuery } from "./verification.schemas";

const REVIEW_REFUSAL_MESSAGES: Record<CaseRefusalCode, string> = {
  MODERATION_SELF_CASE: "No puedes revisar tu propia verificación.",
  MODERATION_PEER_CASE: "La verificación de una cuenta de la plataforma la revisa un administrador de sistema.",
};

/** The decision, plus the facts its audit row needs (gym of the member). */
export type VerificationDecision = {
  submission: SubmissionResponse;
  tenantId: string;
  decision: "APPROVED" | "REJECTED";
  reason: keyof typeof VERIFICATION_REJECTION_REASONS | null;
};

/**
 * Review side, run by the central REPP team (ADR-0018): queue, selfie link,
 * manual decision. Every lookup goes through `platformScopeOf`, so a
 * MODERATOR reviews every gym and a SYSTEM_ADMIN impersonating a gym only
 * that gym.
 */
@Injectable()
export class VerificationReviewService {
  private readonly logger = new Logger(VerificationReviewService.name);

  constructor(
    private readonly sequelize: Sequelize,
    private readonly repository: VerificationRepository,
    private readonly notifications: NotificationService,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
    private readonly cipher: ChatMediaCipher,
    private readonly signer: SelfieLinkSigner,
    @Inject(VERIFICATION_CLOCK) private readonly clock: VerificationClock,
  ) {}

  /** Oldest first, with the requested gesture, a signed selfie link and the member's photos. */
  async listQueue(actor: AuthenticatedUser, query: VerificationQueueQuery): Promise<QueueItemResponse[]> {
    const rows = await this.repository.listQueue(query.status, query.limit, platformScopeOf(actor), {
      id: actor.id,
      seesPlatformAccounts: actor.role === UserRole.SYSTEM_ADMIN,
    });
    const photos = await this.repository.visiblePhotos([...new Set(rows.map((row) => row.verification.userId))]);
    const expiresAt = new Date(this.clock().getTime() + VERIFICATION_RULES.selfieLinkTtlMs);
    return rows.map(({ verification, memberName, tenantId, tenantName }) =>
      mapQueueItem(
        verification,
        { name: memberName, tenantId, tenantName },
        photos.filter((photo) => photo.userId === verification.userId),
        verification.selfieStorageKey ? this.selfieLink(verification.id, actor.id, expiresAt) : null,
      ),
    );
  }

  /** Decrypted selfie bytes for a moderator holding a valid, unexpired link. */
  async readSelfie(
    actor: AuthenticatedUser,
    verificationId: string,
    link: SelfieLinkQuery,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!this.signer.isValid(verificationId, actor.id, link.expires, link.signature, this.clock())) {
      throw new ForbiddenException("El enlace de la selfie caducó o no es válido.");
    }
    const row = (await this.repository.findByIdInScope(verificationId, platformScopeOf(actor)))?.verification;
    if (!row?.selfieStorageKey || !row.selfieMimeType) throw new NotFoundException("Selfie no encontrada.");
    this.assertMayReview(actor, row.userId, await this.repository.accountRole(row.userId));
    const encrypted = await this.storage.download(row.selfieStorageKey);
    this.logger.log({ event: "verification.selfie_viewed", verificationId, reviewerId: actor.id });
    return { buffer: this.cipher.decrypt(encrypted), mimeType: row.selfieMimeType };
  }

  /**
   * Same rule as the moderation cases (ADR-0018 §8): nobody reviews their own
   * selfie, and a MODERATOR never reviews another platform account's.
   */
  private assertMayReview(actor: AuthenticatedUser, memberId: string, memberRole: string | null): void {
    const refusal = caseRefusalFor(actor, { id: memberId, role: memberRole });
    if (!refusal) return;
    this.logger.warn({ event: "verification.review_refused", code: refusal, reviewerId: actor.id });
    throw new DomainException(HttpStatus.FORBIDDEN, refusal, REVIEW_REFUSAL_MESSAGES[refusal]);
  }

  async decide(actor: AuthenticatedUser, verificationId: string, input: DecideVerificationInput): Promise<VerificationDecision> {
    const decided = await this.sequelize.transaction(async (transaction) => {
      const scoped = await this.repository.findByIdInScope(verificationId, platformScopeOf(actor), transaction);
      if (!scoped) throw new NotFoundException("Verificación no encontrada.");
      const row = scoped.verification;
      const target = input.decision === "APPROVE" ? VerificationStatus.APPROVED : VerificationStatus.REJECTED;
      assertTransition(row.status, target);
      const member = await this.repository.lockUser(row.userId, transaction);
      this.assertMayReview(actor, row.userId, member?.role ?? null);
      const now = this.clock();
      const reason = target === VerificationStatus.REJECTED ? (input.reason ?? "OTHER") : null;
      const approvedPhotoIds =
        target === VerificationStatus.APPROVED
          ? await this.comparedPhotoIds(row.userId, input.comparedPhotoIds ?? [], transaction)
          : [];
      await this.repository.update(
        row.id,
        {
          status: target,
          reviewerId: actor.id,
          decisionReason: reason,
          decidedAt: now,
          ...(target === VerificationStatus.APPROVED ? { approvedPhotoIds } : {}),
        },
        transaction,
      );
      if (target === VerificationStatus.APPROVED) await this.repository.setUserVerifiedAt(row.userId, now, transaction);
      await this.notifyMember(row, target === VerificationStatus.APPROVED, reason, transaction);
      return { row: Object.assign(row, { status: target, decidedAt: now }), tenantId: scoped.tenantId, target, reason };
    });
    this.logger.log({ event: "verification.decided", verificationId, status: decided.target, reviewerId: actor.id });
    return {
      submission: mapSubmission(decided.row),
      tenantId: decided.tenantId,
      decision: decided.target === VerificationStatus.APPROVED ? "APPROVED" : "REJECTED",
      reason: decided.reason,
    };
  }

  /** The approval vouches for the photos the moderator saw, and only if they are still the gallery. */
  private async comparedPhotoIds(userId: string, reviewed: readonly string[], transaction: Transaction): Promise<string[]> {
    const photos = await this.repository.visiblePhotos([userId], transaction);
    if (photos.length === 0) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        "VERIFICATION_PHOTOS_REQUIRED",
        "La persona ya no tiene fotos de perfil con las que comparar la selfie.",
      );
    }
    const current = new Set(photos.map((photo) => photo.id));
    const same = reviewed.length === current.size && reviewed.every((id) => current.has(id));
    if (!same) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        "VERIFICATION_PHOTOS_CHANGED",
        "Las fotos de perfil cambiaron mientras revisabas. Vuelve a abrir la verificación.",
      );
    }
    return [...current];
  }

  private async notifyMember(
    row: PhotoVerificationModel,
    approved: boolean,
    reason: keyof typeof VERIFICATION_REJECTION_REASONS | null,
    transaction: Transaction,
  ): Promise<void> {
    await this.notifications.enqueueDirectMessage(
      {
        recipientUserId: row.userId,
        channel: NotificationChannel.IN_APP,
        subject: approved ? "Tu perfil está verificado" : "No pudimos verificar tu perfil",
        // The REPP team decides, never the gym (ADR-0018).
        body: approved
          ? "El equipo de REPP revisó tu selfie y confirmó que eres tú. Tu perfil ya muestra la verificación."
          : `El equipo de REPP revisó tu selfie. ${VERIFICATION_REJECTION_REASONS[reason ?? "OTHER"]} Puedes intentarlo de nuevo con un gesto nuevo.`,
        deduplicationKey: `verification.decided:${row.id}`,
        metadata: { kind: "PHOTO_VERIFICATION", verificationId: row.id, outcome: approved ? "APPROVED" : "REJECTED", reason },
      },
      transaction,
    );
  }

  private selfieLink(verificationId: string, viewerId: string, expiresAt: Date): { url: string; expiresAt: string } {
    const signature = this.signer.sign(verificationId, viewerId, expiresAt);
    const query = `expires=${expiresAt.getTime()}&signature=${signature}`;
    return {
      url: `/${env.API_PREFIX}/admin/verifications/${verificationId}/selfie?${query}`,
      expiresAt: expiresAt.toISOString(),
    };
  }
}
