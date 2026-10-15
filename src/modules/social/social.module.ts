import { forwardRef, Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { ChatEventsService } from "../chat/chat-events.service";
import { UsersModule } from "../users/users.module";
import { ConnectionModel } from "./connection.model";
import { DiscoveryPassModel } from "./discovery-pass.model";
import { ProfileSocialSettingsModel } from "./profile-social-settings.model";
import { SocialMapLocationModel } from "./social-map-location.model";
import { SocialMapPlaceModel } from "./social-map-place.model";
import { SocialMapController } from "./social-map.controller";
import { SocialMapRepository } from "./social-map.repository";
import { SocialMapService } from "./social-map.service";
import { SocialInteractionsController } from "./social-interactions.controller";
import { SocialInteractionsService } from "./social-interactions.service";
import { SocialController } from "./social.controller";
import { SocialRepository } from "./social.repository";
import { SocialService } from "./social.service";
import { RecommendationsClient } from "./recommendations-client";
import { IntegrationModule } from "../integration/integration.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ChatModule } from "../chat/chat.module";

@Module({
  imports: [
    forwardRef(() => ChatModule),
    IntegrationModule,
    NotificationsModule,
    UsersModule,
    SequelizeModule.forFeature([
      ConnectionModel,
      ProfileSocialSettingsModel,
      DiscoveryPassModel,
      SocialMapLocationModel,
      SocialMapPlaceModel,
    ]),
  ],
  controllers: [
    SocialController,
    SocialInteractionsController,
    SocialMapController,
  ],
  providers: [
    ChatEventsService,
    SocialRepository,
    SocialService,
    SocialInteractionsService,
    SocialMapRepository,
    SocialMapService,
    RecommendationsClient,
  ],
  exports: [ChatEventsService, SocialService, SocialRepository],
})
export class SocialModule {}
