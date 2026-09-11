import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { ProfileSocialSettingsModel } from "../social/profile-social-settings.model";
import { UsersModule } from "../users/users.module";
import { ProfileViewModel } from "./profile-view.model";
import { ProfileViewsController } from "./profile-views.controller";
import { ProfileViewsRepository } from "./profile-views.repository";
import { ProfileViewsService } from "./profile-views.service";

@Module({
  // `ProfileSocialSettingsModel` es de social y aquí sólo se lee: guarda la
  // marca de "cuándo abrí la lista por última vez", que es lo que distingue una
  // visita nueva de una ya vista. `forFeature` sólo inyecta el modelo ya
  // registrado en la conexión; no lo redefine ni lo duplica.
  imports: [UsersModule, SequelizeModule.forFeature([ProfileViewModel, ProfileSocialSettingsModel])],
  controllers: [ProfileViewsController],
  providers: [ProfileViewsRepository, ProfileViewsService],
})
export class ProfileViewsModule {}
