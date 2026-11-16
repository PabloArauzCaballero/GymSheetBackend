import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { ReportedContentRetentionService } from "../account/reported-content-retention.service";
import { AntibotPersistenceModule } from "../antibot/antibot-persistence.module";
import { MediaModule } from "../media/media.module";
import { PhotoVerificationModel } from "../verification/photo-verification.model";
import { VerificationRepository } from "../verification/verification.repository";
import { VerificationRetentionService } from "../verification/verification-retention.service";
import { PrivacyRetentionRepository } from "./privacy-retention.repository";
import { PrivacyRetentionService } from "./privacy-retention.service";

/**
 * Data access plus the media release queue, so the retention command and
 * worker boot without HTTP, Redis or anti-bot secrets. The selfie retention
 * needs only the verification rows, not the verification HTTP module.
 */
@Module({
  imports: [AntibotPersistenceModule, MediaModule, SequelizeModule.forFeature([PhotoVerificationModel])],
  providers: [
    PrivacyRetentionRepository,
    ReportedContentRetentionService,
    VerificationRepository,
    VerificationRetentionService,
    PrivacyRetentionService,
  ],
  exports: [PrivacyRetentionService],
})
export class PrivacyRetentionModule {}
