import { Body, Controller, HttpCode, HttpStatus, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequiresVerifiedEmail } from "../../common/decorators/requires-verified-email.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../../common/enums/domain.enums";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { BusinessChatService } from "./business-chat.service";
import { StartBusinessConversationInput, startBusinessConversationSchema } from "./chat.schemas";

/**
 * A person opens a chat with a business (ADR-0023). Business accounts never
 * reach this route (`AccountKindGuard`: 403 `ACCOUNT_KIND_NOT_ALLOWED`).
 * 201 when it was opened now, 200 when the live one already existed.
 */
@Controller("me/business-conversations")
export class PersonBusinessChatController {
  constructor(private readonly service: BusinessChatService) {}

  @RequiresVerifiedEmail()
  @Post()
  async open(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(startBusinessConversationSchema)) input: StartBusinessConversationInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ conversationId: string }> {
    const { conversationId, created } = await this.service.open(user.id, input.entityId);
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return { conversationId };
  }
}

/** The business side of its conversations; reading and answering go through `/me/conversations`. */
@Roles(UserRole.BUSINESS)
@Controller("business/me/conversations")
export class BusinessChatController {
  constructor(private readonly service: BusinessChatService) {}

  /** Blocks the person: the conversation is revoked and the person cannot open a new one. */
  @HttpCode(HttpStatus.OK)
  @Post(":id/block")
  block(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) conversationId: string) {
    return this.service.block(conversationId, { userId: user.id, entityId: user.businessEntityId ?? null });
  }
}
