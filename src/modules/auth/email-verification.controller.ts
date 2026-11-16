import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
import { EmailVerifyConfirmInput, emailVerifyConfirmSchema } from "./auth.schemas";
import { EmailVerificationService } from "./email-verification.service";

const authThrottleOptions = {
  default: { limit: env.AUTH_RATE_LIMIT_MAX, ttl: env.RATE_LIMIT_TTL_SECONDS * 1000 },
};

/** Authenticated: the PIN proves the mailbox of the session's own account. */
@Controller("auth/email/verify")
export class EmailVerificationController {
  constructor(private readonly emailVerification: EmailVerificationService) {}

  /** 202: accepted. Already verified accounts get the same answer and no email. */
  @Throttle(authThrottleOptions)
  @HttpCode(HttpStatus.ACCEPTED)
  @Post("request")
  async request(@CurrentUser() user: AuthenticatedUser) {
    await this.emailVerification.requestPin(user.id);
    return { accepted: true };
  }

  @Throttle(authThrottleOptions)
  @HttpCode(HttpStatus.OK)
  @Post("confirm")
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(emailVerifyConfirmSchema)) input: EmailVerifyConfirmInput,
  ) {
    return this.emailVerification.confirm(user.id, input.pin);
  }
}
