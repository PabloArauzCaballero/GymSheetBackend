import { Body, Controller, Get, Put, Query } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import {
  ReadReceiptSettingsQuery,
  UpdateReadReceiptSettingsInput,
  readReceiptSettingsQuerySchema,
  updateReadReceiptSettingsSchema,
} from "./chat.schemas";
import { ReadReceiptSettingsService } from "./read-receipt-settings.service";

@Controller("me/chat/read-receipts")
export class ReadReceiptSettingsController {
  constructor(private readonly service: ReadReceiptSettingsService) {}

  @Get()
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(readReceiptSettingsQuerySchema)) query: ReadReceiptSettingsQuery,
  ) {
    return this.service.get(user.id, query);
  }

  @Put()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateReadReceiptSettingsSchema)) input: UpdateReadReceiptSettingsInput,
  ) {
    return this.service.update(user.id, input);
  }
}
