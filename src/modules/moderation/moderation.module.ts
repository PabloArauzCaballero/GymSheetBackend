import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { AdminAccessModule } from "../admin-access/admin-access.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ConnectionModel } from "../social/connection.model";
import { DiscoveryPassModel } from "../social/discovery-pass.model";
import {
  ModerationAdminController,
  ReportsController,
} from "./moderation.controller";
import { ModerationRepository } from "./moderation.repository";
import { ModerationService } from "./moderation.service";
import { IntegrationModule } from "../integration/integration.module";
import { ModerationReportModel } from "./report.model";
import { UserStrikeModel } from "./user-strike.model";
import { ReelsModule } from "../reels/reels.module";
import { SocialModule } from "../social/social.module";
import { MediaModule } from "../media/media.module";
import { ModerationAutoHideService } from "./moderation-auto-hide.service";
import { ModerationEvidenceService } from "./moderation-evidence.service";
import { ModerationMinorService } from "./moderation-minor.service";
import { ModerationSafeguardsRepository } from "./moderation-safeguards.repository";
import { PlatformModeratorsController } from "./platform-moderators.controller";
import { PlatformModeratorsService } from "./platform-moderators.service";

@Module({
  imports: [
    SequelizeModule.forFeature([
      ModerationReportModel,
      UserStrikeModel,
      // Denunciar aparta a esa persona de la baraja; el módulo social también
      // aporta el evento que invalida las sesiones de chat revocadas.
      ConnectionModel,
      DiscoveryPassModel,
    ]),
    NotificationsModule,
    IntegrationModule,
    // The verdict writes its own audit row (ADR-0018).
    AdminAccessModule,
    ReelsModule,
    SocialModule,
    MediaModule,
  ],
  controllers: [ReportsController, ModerationAdminController, PlatformModeratorsController],
  providers: [
    ModerationRepository,
    ModerationService,
    ModerationSafeguardsRepository,
    ModerationMinorService,
    ModerationEvidenceService,
    ModerationAutoHideService,
    PlatformModeratorsService,
  ],
  exports: [ModerationService, ModerationEvidenceService],
})
export class ModerationModule {}
