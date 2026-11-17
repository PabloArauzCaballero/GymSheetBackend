import { Controller, Get, Header, Query } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequiresVerifiedEmail } from "../../common/decorators/requires-verified-email.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { GymMembersQuery, GymMembersService, gymMembersQuerySchema } from "./gym-members.service";

/** `GET /me/gym/members` (ADR-0027): 403 `GYM_MEMBERSHIP_REQUIRED` without a confirmed gym. */
@Controller("me/gym/members")
export class GymMembersController {
  constructor(private readonly members: GymMembersService) {}

  @RequiresVerifiedEmail()
  @Get()
  @Header("Cache-Control", "private, no-store")
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(gymMembersQuerySchema)) query: GymMembersQuery,
  ) {
    return this.members.list(user.id, user.tenantId, query);
  }
}
