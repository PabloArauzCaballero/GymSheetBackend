import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { UsersModule } from "../users/users.module";
import { ProfileViewModel } from "./profile-view.model";
import { ProfileViewsController } from "./profile-views.controller";
import { ProfileViewsRepository } from "./profile-views.repository";
import { ProfileViewsService } from "./profile-views.service";

@Module({
  imports: [UsersModule, SequelizeModule.forFeature([ProfileViewModel])],
  controllers: [ProfileViewsController],
  providers: [ProfileViewsRepository, ProfileViewsService],
})
export class ProfileViewsModule {}
