import { Controller, Get, Query } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { PLATFORM_MODERATION_ROLES, platformScopeOf } from "../../common/tenancy/tenant-scope";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../../common/types/auth-context.types";
import { SignupAuditQueryInput, signupAuditQuerySchema } from "./antibot.schemas";
import { SignupModerationService } from "./signup-moderation.service";

/**
 * Recent signup verdicts for moderation. Same gate as the moderation queue:
 * only the platform moderation roles (ADR-0018); gym staff gets 403. A
 * `MODERATOR` or a SYSTEM_ADMIN that is not impersonating sees every gym and
 * the rejections, which have no gym; an impersonating SYSTEM_ADMIN sees the
 * accepted signups of that gym.
 */
@Roles(...PLATFORM_MODERATION_ROLES)
@Controller("admin/signups")
export class SignupAdminController {
  constructor(private readonly moderation: SignupModerationService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(signupAuditQuerySchema)) query: SignupAuditQueryInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.moderation.listRecent(query, platformScopeOf(actor));
  }
}
