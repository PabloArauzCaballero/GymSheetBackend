import { Module } from "@nestjs/common";
import { AntibotPersistenceModule } from "../antibot/antibot-persistence.module";
import { PrivacyRetentionRepository } from "./privacy-retention.repository";
import { PrivacyRetentionService } from "./privacy-retention.service";

/** Data access only, so the retention command boots without HTTP, Redis or anti-bot secrets. */
@Module({
  imports: [AntibotPersistenceModule],
  providers: [PrivacyRetentionRepository, PrivacyRetentionService],
  exports: [PrivacyRetentionService],
})
export class PrivacyRetentionModule {}
