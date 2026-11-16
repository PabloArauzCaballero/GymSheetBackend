import { Controller, Get, Query } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../../common/enums/domain.enums";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../../common/types/auth-context.types";
import { AdminPermissionKey } from "../admin-access/admin-permission.catalog";
import { SignupAuditQueryInput, signupAuditQuerySchema } from "./antibot.schemas";
import { SignupModerationService } from "./signup-moderation.service";

/**
 * Recent signup verdicts for moderation. Same gate as the moderation queue:
 * ADMIN (SYSTEM_ADMIN satisfies it) plus the `moderation:read` permission.
 * The scope comes from `actor.tenantScope`: a gym admin sees its own gym's
 * accepted signups; a platform admin also sees rejections, which have no gym.
 */
@Roles(UserRole.ADMIN)
@Controller("admin/signups")
export class SignupAdminController {
  constructor(private readonly moderation: SignupModerationService) {}

  @Get()
  @RequirePermission(AdminPermissionKey.MODERATION_READ)
  list(
    @Query(new ZodValidationPipe(signupAuditQuerySchema)) query: SignupAuditQueryInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.moderation.listRecent(query, actor.tenantScope);
  }
}
