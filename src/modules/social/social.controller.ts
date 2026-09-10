import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import {
  ConnectionListQuery,
  DirectoryQuery,
  DiscoveryDeckQuery,
  RespondConnectionInput,
  SendConnectionInput,
  SwipeInput,
  UpdateSocialStatusInput,
  connectionListQuerySchema,
  directoryQuerySchema,
  discoveryDeckQuerySchema,
  respondConnectionSchema,
  sendConnectionSchema,
  swipeSchema,
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

  // La baraja se declara antes que `me/gym-directory/:userId` por claridad de
  // lectura; son rutas distintas, no compiten entre sí.
  @Get("me/discovery/deck")
  discoveryDeck(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(discoveryDeckQuerySchema)) query: DiscoveryDeckQuery,
  ) {
    return this.service.discoveryDeck(user.id, user.tenantId, query);
  }

  @Post("me/discovery/swipes")
  swipe(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(swipeSchema)) input: SwipeInput,
  ) {
    return this.service.swipe(user.id, user.tenantId, input);
  }

  @Post("me/discovery/swipes/undo")
  undoSwipe(@CurrentUser() user: AuthenticatedUser) {
    return this.service.undoLastSwipe(user.id);
  }

  @Get("me/gym-directory/:userId")
  memberProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("userId", UuidParamPipe) targetUserId: string,
  ) {
    return this.service.memberProfile(user.id, user.tenantId, targetUserId);
  }
}
