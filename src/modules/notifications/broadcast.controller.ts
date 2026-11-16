import { Body, Controller, Post } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../../common/enums/domain.enums";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { BroadcastService } from "./broadcast.service";
import { BroadcastInput, broadcastSchema } from "./broadcast.schemas";

/** In-app broadcast: REPP's `SYSTEM_ADMIN` sends a campaign to a segment (ADR-0019). */
@Roles(UserRole.SYSTEM_ADMIN)
@Controller("admin/notifications")
export class AdminBroadcastController {
  constructor(private readonly broadcastService: BroadcastService) {}

  @Post("broadcast")
  broadcast(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(broadcastSchema)) input: BroadcastInput,
  ) {
    return this.broadcastService.broadcast(actor, input);
  }
}
