import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { UsersModule } from "../users/users.module";
import { ChallengesRepository } from "./challenges.repository";
import { PrizesRepository } from "./prizes.repository";
import { ProgressionAdminService } from "./progression-admin.service";
import { ProgressionBadgeModel } from "./progression-badge.model";
import { ProgressionLevelModel } from "./progression-level.model";
import {
  ProgressionAdminController,
  ProgressionController,
} from "./progression.controller";
import { ProgressionRepository } from "./progression.repository";
import { ProgressionService } from "./progression.service";
import { RestDayPreferenceModel } from "./rest-day-preference.model";
import { UserBadgeModel } from "./user-badge.model";
import { UserProgressModel } from "./user-progress.model";
import { WeeklyChallengesService } from "./weekly-challenges.service";

@Module({
  imports: [
    UsersModule,
    SequelizeModule.forFeature([
      ProgressionLevelModel,
      ProgressionBadgeModel,
      UserBadgeModel,
      UserProgressModel,
      RestDayPreferenceModel,
    ]),
  ],
  controllers: [ProgressionController, ProgressionAdminController],
  providers: [
    ProgressionRepository,
    ProgressionService,
    ProgressionAdminService,
    ChallengesRepository,
    WeeklyChallengesService,
    PrizesRepository,
  ],
  exports: [ProgressionService],
})
export class ProgressionModule {}
