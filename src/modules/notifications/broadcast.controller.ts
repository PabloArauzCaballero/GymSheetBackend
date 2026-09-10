import { Body, Controller, Post } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../../common/enums/domain.enums";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { BroadcastService } from "./broadcast.service";
import { BroadcastInput, broadcastSchema } from "./broadcast.schemas";

/** Publicidad in-app: el administrador lanza una campaña a un segmento. */
@Roles(UserRole.ADMIN)
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
