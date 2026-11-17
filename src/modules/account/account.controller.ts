import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
import { SkipLegalAcceptance } from "../legal/skip-legal-acceptance.decorator";
import { mapUserToResponse, UserResponse } from "../users/user.mapper";
import { UsersService } from "../users/users.service";
import { AccountClosureService } from "./account-closure.service";
import { CloseAccountInput, closeAccountSchema, UpdateAccountInput, updateAccountSchema } from "./account.schemas";

/** Same budget as the auth routes: these endpoints check a password or a PIN. */
export const accountThrottleOptions = {
  default: { limit: env.AUTH_RATE_LIMIT_MAX, ttl: env.RATE_LIMIT_TTL_SECONDS * 1000 },
};

/**
 * Account rights of the session's own account. Exempt from the legal gate: a
 * person who does not accept new terms must still be able to leave.
 */
@SkipLegalAcceptance()
@Controller("me/account")
export class AccountController {
  constructor(
    private readonly closure: AccountClosureService,
    private readonly users: UsersService,
  ) {}

  @Patch()
  async rename(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateAccountSchema)) input: UpdateAccountInput,
  ): Promise<UserResponse> {
    return mapUserToResponse(await this.users.updateFullName(user.id, input.nombreCompleto));
  }

  @Get("closure-preview")
  preview(@CurrentUser() user: AuthenticatedUser) {
    return this.closure.preview(user.id);
  }

  /** 202: a PIN is on its way. Only for accounts created with Google or Apple. */
  @Throttle(accountThrottleOptions)
  @HttpCode(HttpStatus.ACCEPTED)
  @Post("closure-pin")
  async requestClosurePin(@CurrentUser() user: AuthenticatedUser) {
    await this.closure.requestPin(user.id);
    return { accepted: true };
  }

  @Throttle(accountThrottleOptions)
  @HttpCode(HttpStatus.OK)
  @Delete()
  close(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(closeAccountSchema)) input: CloseAccountInput,
  ) {
    return this.closure.close(user.id, input);
  }
}
