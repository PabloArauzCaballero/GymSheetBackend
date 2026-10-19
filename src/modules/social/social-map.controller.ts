import { Body, Controller, Get, Param, Patch, Query } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { SocialMapBoundsInput, UpdateSocialMapLocationInput, socialMapBoundsSchema, socialMapCellIdSchema, socialMapCityQuerySchema, socialMapNearbyQuerySchema, SocialMapNearbyQueryInput, updateSocialMapLocationSchema } from "./social-map.schemas";
import { SocialMapService } from "./social-map.service";

@Controller("me/social-map")
export class SocialMapController {
  constructor(private readonly service: SocialMapService) {}

  @Patch("location")
  setLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateSocialMapLocationSchema)) input: UpdateSocialMapLocationInput,
  ) {
    return this.service.setLocation(user.id, input);
  }

  @Get("areas")
  areas(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(socialMapBoundsSchema)) bounds: SocialMapBoundsInput,
  ) {
    return this.service.areas(user.id, bounds);
  }

  @Get("cells/:cellId/people")
  peopleInCell(
    @CurrentUser() user: AuthenticatedUser,
    @Param("cellId", new ZodValidationPipe(socialMapCellIdSchema)) cellId: string,
  ) {
    return this.service.peopleInCell(user.id, user.tenantId, cellId);
  }

  @Get("nearby")
  nearby(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(socialMapNearbyQuerySchema)) point: SocialMapNearbyQueryInput,
  ) {
    return this.service.nearby(user.id, user.tenantId, point);
  }

  @Get("gyms")
  gyms(@Query(new ZodValidationPipe(socialMapBoundsSchema)) bounds: SocialMapBoundsInput) {
    return this.service.gyms(bounds);
  }

  @Get("cities")
  cities(@Query(new ZodValidationPipe(socialMapCityQuerySchema)) query: { q: string }) {
    return this.service.cities(query.q);
  }
}
