import { Body, Controller, Get, Post } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { ProfileViewsService } from "./profile-views.service";
import { RecordProfileViewInput, recordProfileViewSchema } from "./profile-views.schemas";

@Controller("me/profile-views")
export class ProfileViewsController {
  constructor(private readonly service: ProfileViewsService) {}

  @Post()
  async record(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(recordProfileViewSchema)) input: RecordProfileViewInput,
  ) {
    await this.service.record(user.id, user.tenantId, input.viewedUserId);
    return { recorded: true };
  }

  @Get("summary")
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.service.summary(user.id);
  }
}
