import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { SkipLegalAcceptance } from "../legal/skip-legal-acceptance.decorator";
import { accountThrottleOptions } from "./account.controller";
import {
  EmailChangeConfirmInput,
  emailChangeConfirmSchema,
  EmailChangeRequestInput,
  emailChangeRequestSchema,
} from "./account.schemas";
import { EmailChangeService } from "./email-change.service";

@SkipLegalAcceptance()
@Controller("me/email/change")
export class EmailChangeController {
  constructor(private readonly emailChange: EmailChangeService) {}

  /** 202: the PIN goes to the new address. The same answer whether or not it is taken. */
  @Throttle(accountThrottleOptions)
  @HttpCode(HttpStatus.ACCEPTED)
  @Post()
  async request(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(emailChangeRequestSchema)) input: EmailChangeRequestInput,
  ) {
    await this.emailChange.request(user.id, input);
    return { accepted: true };
  }

  @Throttle(accountThrottleOptions)
  @HttpCode(HttpStatus.OK)
  @Post("confirm")
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(emailChangeConfirmSchema)) input: EmailChangeConfirmInput,
  ) {
    return this.emailChange.confirm(user.id, input.pin);
  }
}
