import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { UniqueConstraintError } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { DomainException } from "../../common/errors/domain.exception";
import { ChatMediaCipher } from "../chat/chat-media-cipher";
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider, mediaTargetPrefix } from "../media/media-storage.port";
import { PhotoVerificationModel } from "./photo-verification.model";
import { UploadedSelfie, validateSelfie } from "./selfie-image";
import { pickGesture, VerificationStatus } from "./verification.catalog";
import { VERIFICATION_CONSENT_PORT, VerificationConsentPort } from "./verification-consent.port";
import {
  ChallengeResponse,
  mapChallenge,
  mapDecision,
  mapSubmission,
  MyVerificationResponse,
  MyVerificationStatus,
  SubmissionResponse,
} from "./verification.mapper";
import {
  assertTransition,
  challengeExpired,
  isChallengeExpired,
  nextAttemptAt,
  rateLimited,
  VERIFICATION_CLOCK,
  VERIFICATION_RULES,
  VerificationClock,
} from "./verification.policy";
import { VerificationRepository } from "./verification.repository";

/** Member side of the person verification: challenge, selfie upload, own state. */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly sequelize: Sequelize,
    private readonly repository: VerificationRepository,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
    private readonly cipher: ChatMediaCipher,
    @Inject(VERIFICATION_CONSENT_PORT) private readonly consent: VerificationConsentPort,
    @Inject(VERIFICATION_CLOCK) private readonly clock: VerificationClock,
  ) {}

  async issueChallenge(userId: string): Promise<ChallengeResponse> {
    // A selfie is biometric data that must be deletable 30 days after the
    // decision: if the storage cannot delete in this member's selfie folder
    // (ADR-0017 flag off, or a provider that keeps everything), the feature stays closed.
    if (!this.storage.canRemove(`${mediaTargetPrefix({ category: "verificaciones", ownerUserId: userId })}/selfie`)) {
      this.logger.error({ event: "verification.unavailable", reason: "immutable_storage" });
      throw new DomainException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "VERIFICATION_UNAVAILABLE",
        "La verificación no está disponible en este momento.",
      );
    }
    try {
      const row = await this.sequelize.transaction(async (transaction) => {
        // Consent first, as a revocation locks it: one that runs meanwhile waits and then cancels this challenge.
        await this.consent.assertGranted(userId, transaction);
        const now = this.clock();
        const user = await this.repository.lockUser(userId, transaction);
        if (!user) throw new NotFoundException("Cuenta no encontrada.");
        if (user.verifiedAt) {
          throw new DomainException(HttpStatus.CONFLICT, "VERIFICATION_ALREADY_VERIFIED", "Tu perfil ya está verificado.");
        }
        const active = await this.repository.findActiveForUser(userId, transaction);
        if (active?.status === VerificationStatus.PENDING_REVIEW) {
          throw new DomainException(
            HttpStatus.CONFLICT,
            "VERIFICATION_IN_REVIEW",
            "El equipo de REPP ya está revisando tu selfie. Te avisaremos cuando decida.",
          );
        }
        const photos = await this.repository.visiblePhotos([userId], transaction);
        if (photos.length < VERIFICATION_RULES.minProfilePhotos) {
          throw new DomainException(
            HttpStatus.BAD_REQUEST,
            "VERIFICATION_PHOTOS_REQUIRED",
            `Necesitas al menos ${VERIFICATION_RULES.minProfilePhotos} fotos de perfil para verificarte.`,
          );
        }
        const since = new Date(now.getTime() - VERIFICATION_RULES.attemptWindowMs);
        const retryAt = nextAttemptAt(await this.repository.attemptDatesSince(userId, since, transaction), now);
        if (retryAt) throw rateLimited(retryAt, now);

        // A new challenge replaces an unanswered one: the old gesture can no longer be used.
        if (active) await this.repository.update(active.id, { status: VerificationStatus.EXPIRED }, transaction);
        const previous = await this.repository.findLatestForUser(userId, transaction);
        return this.repository.create(
          {
            userId,
            gestureCode: pickGesture(previous?.gestureCode ?? null).code,
            issuedAt: now,
            expiresAt: new Date(now.getTime() + VERIFICATION_RULES.challengeTtlMs),
          },
          transaction,
        );
      });
      return mapChallenge(row);
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) {
        throw new DomainException(HttpStatus.CONFLICT, "VERIFICATION_STATE_CONFLICT", "Ya tienes una verificación en curso.");
      }
      throw error;
    }
  }

  async submitSelfie(userId: string, verificationId: string, file: UploadedSelfie | undefined): Promise<SubmissionResponse> {
    // Unlocked check before storing anything; repeated under lock where the key is written.
    await this.consent.assertGranted(userId);
    const row = await this.repository.findByIdForUser(verificationId, userId);
    if (!row) throw new NotFoundException("Verificación no encontrada.");
    await this.assertAwaitingUpload(row);
    const selfie = validateSelfie(file);
    const mimeType = selfie.mimeType;
    const buffer = this.cipher.encrypt(selfie.buffer);
    const stored = await this.storage.upload(
      { originalName: "selfie", mimeType, sizeBytes: buffer.byteLength, buffer },
      { category: "verificaciones", ownerUserId: userId },
    );
    try {
      const submitted = await this.sequelize.transaction(async (transaction) => {
        // Locked re-check: a revocation that won the race already erased; one that loses waits and erases this key.
        await this.consent.assertGranted(userId, transaction);
        const locked = await this.repository.findByIdForUser(verificationId, userId, transaction);
        if (!locked) throw new NotFoundException("Verificación no encontrada.");
        assertTransition(locked.status, VerificationStatus.PENDING_REVIEW);
        const now = this.clock();
        if (isChallengeExpired(locked.challengeExpiresAt, now)) throw challengeExpired();
        await this.repository.update(
          locked.id,
          { status: VerificationStatus.PENDING_REVIEW, selfieStorageKey: stored.key, selfieMimeType: mimeType, submittedAt: now },
          transaction,
        );
        return Object.assign(locked, { status: VerificationStatus.PENDING_REVIEW, submittedAt: now });
      });
      this.logger.log({ event: "verification.selfie_submitted", verificationId });
      return mapSubmission(submitted);
    } catch (error: unknown) {
      await this.discardUpload(stored.key);
      throw error;
    }
  }

  async getMine(userId: string): Promise<MyVerificationResponse> {
    const now = this.clock();
    const [verifiedAt, latest, decided, attempts] = await Promise.all([
      this.repository.userVerifiedAt(userId),
      this.repository.findLatestForUser(userId),
      this.repository.findLatestDecided(userId),
      this.repository.attemptDatesSince(userId, new Date(now.getTime() - VERIFICATION_RULES.attemptWindowMs)),
    ]);
    const status = this.currentStatus(latest, verifiedAt, now);
    const retryAt = verifiedAt || status === VerificationStatus.PENDING_REVIEW ? null : nextAttemptAt(attempts, now);
    return {
      status,
      verifiedAt: verifiedAt?.toISOString() ?? null,
      challenge: status === VerificationStatus.PENDING_UPLOAD && latest ? mapChallenge(latest) : null,
      lastDecision: mapDecision(decided),
      canRetryAt: retryAt?.toISOString() ?? null,
    };
  }

  private currentStatus(latest: PhotoVerificationModel | null, verifiedAt: Date | null, now: Date): MyVerificationStatus {
    if (!latest) return verifiedAt ? VerificationStatus.APPROVED : "NONE";
    if (latest.status === VerificationStatus.PENDING_UPLOAD && isChallengeExpired(latest.challengeExpiresAt, now)) {
      return VerificationStatus.EXPIRED;
    }
    if (latest.status === VerificationStatus.APPROVED && !verifiedAt) return "REVOKED";
    return latest.status;
  }

  /** An expired challenge is closed on the spot, so the next request starts clean. */
  private async assertAwaitingUpload(row: PhotoVerificationModel): Promise<void> {
    assertTransition(row.status, VerificationStatus.PENDING_REVIEW);
    if (!isChallengeExpired(row.challengeExpiresAt, this.clock())) return;
    await this.repository.update(row.id, { status: VerificationStatus.EXPIRED });
    throw challengeExpired();
  }

  private async discardUpload(storageKey: string): Promise<void> {
    try {
      await this.storage.remove(storageKey);
    } catch (error: unknown) {
      // The retention pass only sees keys stored in rows; log so the orphan can be found.
      this.logger.error({
        event: "verification.selfie_orphaned",
        storageKey,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}

