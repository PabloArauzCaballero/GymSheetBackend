import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { ReportedContentRetentionService } from "../account/reported-content-retention.service";
import { AntibotPersistenceModule } from "../antibot/antibot-persistence.module";
import { KycRetentionService } from "../business-kyc/kyc-retention.service";
import { MediaModule } from "../media/media.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PhotoVerificationModel } from "../verification/photo-verification.model";
import { VerificationRepository } from "../verification/verification.repository";
import { VerificationRetentionService } from "../verification/verification-retention.service";
import { PrivacyRetentionRepository } from "./privacy-retention.repository";
import { PrivacyRetentionService } from "./privacy-retention.service";

/**
 * Data access plus the media release queue, so the retention command and
 * worker boot without HTTP, Redis or anti-bot secrets. The selfie retention
 * needs only the verification rows, not the verification HTTP module, plus
 * the notifications to tell a member that its review expired.
 */
@Module({
  imports: [AntibotPersistenceModule, MediaModule, NotificationsModule, SequelizeModule.forFeature([PhotoVerificationModel])],
  providers: [
    PrivacyRetentionRepository,
    ReportedContentRetentionService,
    VerificationRepository,
    VerificationRetentionService,
    KycRetentionService,
    PrivacyRetentionService,
  ],
  exports: [PrivacyRetentionService],
})
export class PrivacyRetentionModule {}
