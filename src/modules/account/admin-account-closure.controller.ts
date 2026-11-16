import { Controller, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { Audited } from "../../common/decorators/audited.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../../common/enums/domain.enums";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { AccountClosureService } from "./account-closure.service";

/**
 * Closure of a staff account by its gym. The staff member cannot close it
 * (`ACCOUNT_CLOSURE_STAFF`): the gym answers for those accounts, so the gym's
 * admin does, with the same erasure as any closure. Audited (who closed whom).
 */
@Roles(UserRole.ADMIN)
@Controller("admin/users")
export class AdminAccountClosureController {
  constructor(private readonly closure: AccountClosureService) {}

  @HttpCode(HttpStatus.OK)
  @Post(":id/close")
  @Audited({ domain: "account", action: "close", targetKind: "user", targetParam: "id" })
  close(@Param("id", UuidParamPipe) userId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.closure.closeStaffByAdmin(actor, userId);
  }
}
