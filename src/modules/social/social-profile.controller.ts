import { Body, Controller, Get, Put } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import {
  UpdateSocialProfileInput,
  updateSocialProfileSchema,
} from "./social-profile.schemas";
import { SocialProfileService } from "./social-profile.service";

@Controller()
export class SocialProfileController {
  constructor(private readonly service: SocialProfileService) {}

  @Get("social/catalog/interests")
  interestCatalog() {
    return this.service.interestCatalog();
  }

  @Get("me/social-profile")
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getMine(user.id);
  }

  @Put("me/social-profile")
  updateMine(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateSocialProfileSchema))
    input: UpdateSocialProfileInput,
  ) {
    return this.service.updateMine(user.id, input);
  }

  @Get("me/discovery/readiness")
  discoveryReadiness(@CurrentUser() user: AuthenticatedUser) {
    return this.service.discoveryReadiness(user.id);
  }
}
