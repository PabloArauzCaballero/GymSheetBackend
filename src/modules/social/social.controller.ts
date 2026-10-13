import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res } from "@nestjs/common";
import type { Response } from "express";
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
  UpdateSocialDiscoverySettingsInput,
  DiscoveryPreferencesInput,
  connectionListQuerySchema,
  directoryQuerySchema,
  discoveryDeckQuerySchema,
  respondConnectionSchema,
  sendConnectionSchema,
  socialBlockSchema,
  swipeSchema,
  updateSocialStatusSchema,
  updateSocialDiscoverySettingsSchema,
  discoveryPreferencesInputSchema,
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

  @Get("me/blocks")
  listBlocks(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listBlockedUsers(user.id);
  }

  @Post("me/blocks")
  block(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(socialBlockSchema)) input: { targetUserId: string }) {
    return this.service.blockUser(user.id, input.targetUserId);
  }

  @Delete("me/blocks/:targetUserId")
  unblock(@CurrentUser() user: AuthenticatedUser, @Param("targetUserId", UuidParamPipe) targetUserId: string) {
    return this.service.unblockUser(user.id, targetUserId);
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

  @Get("me/social-discovery-settings")
  getDiscoverySettings(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getDiscoverySettings(user.id);
  }

  @Patch("me/social-discovery-settings")
  updateDiscoverySettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateSocialDiscoverySettingsSchema)) input: UpdateSocialDiscoverySettingsInput,
  ) {
    return this.service.updateDiscoverySettings(user.id, input);
  }

  @Get("me/discovery/preferences")
  getDiscoveryPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getDiscoveryPreferences(user.id);
  }

  @Put("me/discovery/preferences")
  updateDiscoveryPreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(discoveryPreferencesInputSchema)) input: DiscoveryPreferencesInput,
  ) {
    return this.service.updateDiscoveryPreferences(user.id, input);
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
  async discoveryDeck(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(discoveryDeckQuerySchema)) query: DiscoveryDeckQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    const page = await this.service.discoveryDeckPage(user.id, user.tenantId, query);
    if (page.nextCursor) response.setHeader("X-Next-Cursor", page.nextCursor);
    return page.items;
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
