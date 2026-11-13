import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { MediaModule } from "../media/media.module";
import { AnthropometricProfileModel } from "./anthropometric-profile.model";
import { ProfilesController } from "./profiles.controller";
import { ProfilesRepository } from "./profiles.repository";
import { IntegrationModule } from "../integration/integration.module";
import { ProfilesService } from "./profiles.service";
import { BodyMeasurementModel } from "./body-measurement.model";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingModel } from "./onboarding.model";
import { OnboardingRepository } from "./onboarding.repository";
import { OnboardingService } from "./onboarding.service";
import { ProfilePhotoModel } from "./profile-photo.model";
import { ProfilePhotosController } from "./profile-photos.controller";
import { ProfilePhotosRepository } from "./profile-photos.repository";
import { ProfilePhotosService } from "./profile-photos.service";
import { TutorialProgressController } from "./tutorial-progress.controller";
import { TutorialProgressService } from "./tutorial-progress.service";

@Module({
  imports: [
    MediaModule,
    IntegrationModule,
    SequelizeModule.forFeature([
      AnthropometricProfileModel,
      OnboardingModel,
      BodyMeasurementModel,
      ProfilePhotoModel,
    ]),
  ],
  controllers: [ProfilesController, OnboardingController, ProfilePhotosController, TutorialProgressController],
  providers: [
    ProfilesRepository,
    ProfilesService,
    OnboardingRepository,
    OnboardingService,
    ProfilePhotosRepository,
    ProfilePhotosService,
    TutorialProgressService,
  ],
  exports: [ProfilesService],
})
export class ProfilesModule {}
