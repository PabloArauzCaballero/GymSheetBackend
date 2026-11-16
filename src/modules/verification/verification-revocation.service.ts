import { Inject, Injectable, Logger } from "@nestjs/common";
import { Transaction } from "sequelize";
import { NotificationChannel } from "../../common/enums/domain.enums";
import { NotificationService } from "../notifications/notification.service";
import { VERIFICATION_CLOCK, VerificationClock } from "./verification.policy";
import { VerificationRepository } from "./verification.repository";

/**
 * The verification vouches for the photos the moderator compared the selfie
 * with. Once the member removed every one of them the badge no longer says
 * anything, so `verified_at` is cleared and the member is told. Adding photos
 * keeps it. Runs inside the photo deletion transaction.
 */
@Injectable()
export class VerificationRevocationService {
  private readonly logger = new Logger(VerificationRevocationService.name);

  constructor(
    private readonly repository: VerificationRepository,
    private readonly notifications: NotificationService,
    @Inject(VERIFICATION_CLOCK) private readonly clock: VerificationClock,
  ) {}

  /** Returns true when the verification was revoked by this call. */
  async revokeIfComparedPhotosGone(userId: string, transaction: Transaction): Promise<boolean> {
    const user = await this.repository.lockUser(userId, transaction);
    if (!user?.verifiedAt) return false;
    const approval = await this.repository.findLatestApproved(userId, transaction);
    const compared = approval?.approvedPhotoIds ?? [];
    if (!approval || compared.length === 0) return false;
    if ((await this.repository.countExistingPhotos(userId, compared, transaction)) > 0) return false;

    const now = this.clock();
    await this.repository.setUserVerifiedAt(userId, null, transaction);
    await this.repository.update(approval.id, { revokedAt: now }, transaction);
    await this.notifications.enqueueDirectMessage(
      {
        recipientUserId: userId,
        channel: NotificationChannel.IN_APP,
        subject: "Tu perfil dejó de estar verificado",
        body: "Cambiaste todas las fotos con las que verificamos tu identidad. Vuelve a verificarte con una selfie nueva.",
        deduplicationKey: `verification.revoked:${approval.id}`,
        metadata: { kind: "PHOTO_VERIFICATION", verificationId: approval.id, outcome: "REVOKED" },
      },
      transaction,
    );
    this.logger.log({ event: "verification.revoked", verificationId: approval.id });
    return true;
  }
}
