import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { UsersModule } from "../users/users.module";
import { ProgressionAdminService } from "./progression-admin.service";
import { ProgressionBadgeModel } from "./progression-badge.model";
import { ProgressionLevelModel } from "./progression-level.model";
import {
  ProgressionAdminController,
  ProgressionController,
} from "./progression.controller";
import { ProgressionRepository } from "./progression.repository";
import { ProgressionService } from "./progression.service";
import { UserBadgeModel } from "./user-badge.model";
import { UserProgressModel } from "./user-progress.model";

@Module({
  imports: [
    UsersModule,
    SequelizeModule.forFeature([
      ProgressionLevelModel,
      ProgressionBadgeModel,
      UserBadgeModel,
      UserProgressModel,
    ]),
  ],
  controllers: [ProgressionController, ProgressionAdminController],
  providers: [ProgressionRepository, ProgressionService, ProgressionAdminService],
  exports: [ProgressionService],
})
export class ProgressionModule {}
