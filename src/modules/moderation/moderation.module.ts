import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
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
    ReelsModule,
    SocialModule,
  ],
  controllers: [ReportsController, ModerationAdminController],
  providers: [ModerationRepository, ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
