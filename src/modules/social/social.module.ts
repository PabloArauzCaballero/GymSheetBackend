import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { UsersModule } from "../users/users.module";
import { ConnectionModel } from "./connection.model";
import { DiscoveryPassModel } from "./discovery-pass.model";
import { ProfileSocialSettingsModel } from "./profile-social-settings.model";
import { SocialInteractionsController } from "./social-interactions.controller";
import { SocialInteractionsService } from "./social-interactions.service";
import { SocialController } from "./social.controller";
import { SocialRepository } from "./social.repository";
import { SocialService } from "./social.service";

@Module({
  imports: [
    UsersModule,
    SequelizeModule.forFeature([ConnectionModel, ProfileSocialSettingsModel, DiscoveryPassModel]),
  ],
  controllers: [SocialController, SocialInteractionsController],
  providers: [SocialRepository, SocialService, SocialInteractionsService],
  exports: [SocialService, SocialRepository],
})
export class SocialModule {}
