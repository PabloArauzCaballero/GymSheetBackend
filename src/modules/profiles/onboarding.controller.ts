import { Body, Controller, Get, Post, Put } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { OnboardingService } from "./onboarding.service";
import {
  BodyMeasurementInput,
  OnboardingEquipmentInput,
  OnboardingGoalsInput,
  OnboardingPreferencesInput,
  OnboardingProfileInput,
  bodyMeasurementSchema,
  onboardingEquipmentSchema,
  onboardingGoalsSchema,
  onboardingPreferencesSchema,
  onboardingProfileSchema,
} from "./onboarding.schemas";

@Controller("me")
export class OnboardingController {
  constructor(private readonly service: OnboardingService) {}
  @Get("onboarding") get(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getState(user.id);
  }
  @Put("onboarding/profile") profile(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(onboardingProfileSchema))
    input: OnboardingProfileInput,
  ) {
    return this.service.saveProfile(user.id, input);
  }
  @Put("onboarding/goals") goals(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(onboardingGoalsSchema))
    input: OnboardingGoalsInput,
  ) {
    return this.service.saveGoals(user.id, input);
  }
  @Put("onboarding/preferences") preferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(onboardingPreferencesSchema))
    input: OnboardingPreferencesInput,
  ) {
    return this.service.savePreferences(user.id, input);
  }
  @Put("onboarding/equipment") equipment(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(onboardingEquipmentSchema))
    input: OnboardingEquipmentInput,
  ) {
    return this.service.saveEquipment(user.id, input);
  }
  @Post("onboarding/complete") complete(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.complete(user.id);
  }
  @Get("body-measurements") measurements(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listMeasurements(user.id);
  }
  @Post("body-measurements") addMeasurement(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(bodyMeasurementSchema))
    input: BodyMeasurementInput,
  ) {
    return this.service.addMeasurement(user.id, input);
  }
}
