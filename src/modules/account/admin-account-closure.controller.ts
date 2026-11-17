import { Controller, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { Audited } from "../../common/decorators/audited.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../../common/enums/domain.enums";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { AccountClosureService } from "./account-closure.service";

/**
 * Closure of a legacy gym staff account. The staff member cannot close it
 * (`ACCOUNT_CLOSURE_STAFF`) and the gym no longer has staff powers (ADR-0019),
 * so REPP's `SYSTEM_ADMIN` does, with the same erasure as any closure. Audited
 * (who closed whom). Kept until the staff roles are removed (franja 7d).
 */
@Roles(UserRole.SYSTEM_ADMIN)
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
