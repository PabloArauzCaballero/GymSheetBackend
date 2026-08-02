import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { AnthropometricProfileModel } from "./anthropometric-profile.model";
import { ProfilesController } from "./profiles.controller";
import { ProfilesRepository } from "./profiles.repository";
import { ProfilesService } from "./profiles.service";
import { BodyMeasurementModel } from "./body-measurement.model";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingModel } from "./onboarding.model";
import { OnboardingRepository } from "./onboarding.repository";
import { OnboardingService } from "./onboarding.service";

@Module({
  imports: [
    SequelizeModule.forFeature([
      AnthropometricProfileModel,
      OnboardingModel,
      BodyMeasurementModel,
    ]),
  ],
  controllers: [ProfilesController, OnboardingController],
  providers: [
    ProfilesRepository,
    ProfilesService,
    OnboardingRepository,
    OnboardingService,
  ],
  exports: [ProfilesService],
})
export class ProfilesModule {}
