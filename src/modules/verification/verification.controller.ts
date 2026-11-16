import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Audited } from "../../common/decorators/audited.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import { RequiresVerifiedEmail } from "../../common/decorators/requires-verified-email.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../../common/enums/domain.enums";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
import { AdminPermissionKey } from "../admin-access/admin-permission.catalog";
import { UploadedSelfie } from "./selfie-image";
import { VerificationReviewService } from "./verification-review.service";
import {
  DecideVerificationInput,
  decideVerificationSchema,
  SelfieLinkQuery,
  selfieLinkQuerySchema,
  VerificationQueueQuery,
  verificationQueueQuerySchema,
} from "./verification.schemas";
import { VerificationService } from "./verification.service";

/** Person verification of the authenticated member. Staff accounts get 403. */
@Roles(UserRole.CLIENT)
@RequiresVerifiedEmail()
@Controller("me/verification")
export class VerificationController {
  constructor(private readonly service: VerificationService) {}

  @Get()
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getMine(user.id);
  }

  @Post("challenge")
  challenge(@CurrentUser() user: AuthenticatedUser) {
    return this.service.issueChallenge(user.id);
  }

  @Post(":id/selfie")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: env.MEDIA_UPLOAD_MAX_BYTES, files: 1 } }))
  selfie(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) verificationId: string,
    @UploadedFile() file: UploadedSelfie | undefined,
  ) {
    return this.service.submitSelfie(user.id, verificationId, file);
  }
}

/** Manual review queue. Same floor as the moderation console; the permission narrows it. */
@Roles(UserRole.ADMIN, UserRole.FRONT_DESK)
@Controller("admin/verifications")
export class VerificationAdminController {
  constructor(private readonly review: VerificationReviewService) {}

  @Get()
  @RequirePermission(AdminPermissionKey.MODERATION_READ)
  queue(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(new ZodValidationPipe(verificationQueueQuerySchema)) query: VerificationQueueQuery,
  ) {
    return this.review.listQueue(actor, query);
  }

  @Get(":id/selfie")
  @RequirePermission(AdminPermissionKey.MODERATION_READ)
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  async selfie(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", UuidParamPipe) verificationId: string,
    @Query(new ZodValidationPipe(selfieLinkQuerySchema)) link: SelfieLinkQuery,
  ): Promise<StreamableFile> {
    const media = await this.review.readSelfie(actor, verificationId, link);
    return new StreamableFile(media.buffer, { type: media.mimeType, disposition: "inline" });
  }

  @Post(":id/decide")
  @HttpCode(200)
  @RequirePermission(AdminPermissionKey.MODERATION_ACT)
  @Audited({ domain: "moderation", action: "verification_decided", targetKind: "photo_verification", targetParam: "id" })
  decide(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", UuidParamPipe) verificationId: string,
    @Body(new ZodValidationPipe(decideVerificationSchema)) input: DecideVerificationInput,
  ) {
    return this.review.decide(actor, verificationId, input);
  }
}
