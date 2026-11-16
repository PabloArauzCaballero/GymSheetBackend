import { Module } from "@nestjs/common";
import { ReportedContentRetentionService } from "../account/reported-content-retention.service";
import { AntibotPersistenceModule } from "../antibot/antibot-persistence.module";
import { MediaModule } from "../media/media.module";
import { PrivacyRetentionRepository } from "./privacy-retention.repository";
import { PrivacyRetentionService } from "./privacy-retention.service";

/**
 * Data access plus the media release queue, so the retention command and
 * worker boot without HTTP, Redis or anti-bot secrets.
 */
@Module({
  imports: [AntibotPersistenceModule, MediaModule],
  providers: [PrivacyRetentionRepository, ReportedContentRetentionService, PrivacyRetentionService],
  exports: [PrivacyRetentionService],
})
export class PrivacyRetentionModule {}
