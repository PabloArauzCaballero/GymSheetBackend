import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from "@nestjs/common";
import { Audited } from "../../common/decorators/audited.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../../common/enums/domain.enums";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { PlatformModeratorsService } from "./platform-moderators.service";

/**
 * The central REPP moderation team (ADR-0018). Only `SYSTEM_ADMIN`: neither a
 * gym nor a moderator can make moderators, and every change is audited.
 */
@Roles(UserRole.SYSTEM_ADMIN)
@Controller("admin/platform/moderators")
export class PlatformModeratorsController {
  constructor(private readonly moderators: PlatformModeratorsService) {}

  @Get()
  list() {
    return this.moderators.list();
  }

  @Put(":userId")
  @Audited({ domain: "moderation", action: "moderator-assign", targetKind: "user", targetParam: "userId" })
  assign(@Param("userId", UuidParamPipe) userId: string) {
    return this.moderators.assign(userId);
  }

  @Delete(":userId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited({ domain: "moderation", action: "moderator-revoke", targetKind: "user", targetParam: "userId" })
  async revoke(@Param("userId", UuidParamPipe) userId: string): Promise<void> {
    await this.moderators.revoke(userId);
  }
}
