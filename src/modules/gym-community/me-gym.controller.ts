import { Body, Controller, Get, Header, Put } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { MembershipVisibilityInput, membershipVisibilitySchema } from "./my-gym.schemas";
import { MyGymService } from "./my-gym.service";

/**
 * The person's «Mi gimnasio» card (ADR-0027): NONE, REQUESTED («Solicitud
 * enviada») or CONFIRMED, and the switch that shows or hides the membership.
 * Persons only (`AccountKindGuard`).
 */
@Controller("me/gym")
export class MeGymController {
  constructor(private readonly myGym: MyGymService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.myGym.state(user.id);
  }

  @Put("visibility")
  setVisibility(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(membershipVisibilitySchema)) input: MembershipVisibilityInput,
  ) {
    return this.myGym.setMembershipVisible(user.id, input.membershipVisible);
  }
}
