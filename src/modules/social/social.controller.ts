import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import {
  ConnectionListQuery,
  DirectoryQuery,
  RespondConnectionInput,
  SendConnectionInput,
  UpdateSocialStatusInput,
  connectionListQuerySchema,
  directoryQuerySchema,
  respondConnectionSchema,
  sendConnectionSchema,
  updateSocialStatusSchema,
} from "./social.schemas";
import { SocialService } from "./social.service";

@Controller()
export class SocialController {
  constructor(private readonly service: SocialService) {}

  @Get("me/connections")
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(connectionListQuerySchema)) query: ConnectionListQuery,
  ) {
    return this.service.listConnections(user.id, query.status);
  }

  @Post("me/connections")
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(sendConnectionSchema)) input: SendConnectionInput,
  ) {
    return this.service.sendConnection(user.id, user.tenantId, input.addresseeId);
  }

  @Patch("me/connections/:id")
  respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) connectionId: string,
    @Body(new ZodValidationPipe(respondConnectionSchema)) input: RespondConnectionInput,
  ) {
    return this.service.respondConnection(connectionId, user.id, input);
  }

  @Delete("me/connections/:id")
  withdraw(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) connectionId: string) {
    return this.service.withdrawConnection(connectionId, user.id);
  }

  @Get("me/social-status")
  getSocialStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getSocialStatus(user.id);
  }

  @Patch("me/social-status")
  updateSocialStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateSocialStatusSchema)) input: UpdateSocialStatusInput,
  ) {
    return this.service.updateSocialStatus(user.id, input);
  }

  @Get("me/gym-directory")
  directory(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(directoryQuerySchema)) query: DirectoryQuery,
  ) {
    return this.service.directory(user.id, user.tenantId, query);
  }
}
