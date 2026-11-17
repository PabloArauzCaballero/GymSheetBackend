import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequiresVerifiedEmail } from "../../common/decorators/requires-verified-email.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../../common/enums/domain.enums";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { PLATFORM_MODERATION_ROLES } from "../../common/tenancy/tenant-scope";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
import { AuditLogService } from "../admin-access/audit-log.service";
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

/**
 * Manual review queue of the central REPP team (ADR-0018): `MODERATOR` (every
 * gym) and `SYSTEM_ADMIN` (every gym, or the impersonated one). Gym staff gets
 * 403 whatever it was granted: a selfie is biometric data the gym never sees.
 */
@Roles(...PLATFORM_MODERATION_ROLES)
@Controller("admin/verifications")
export class VerificationAdminController {
  constructor(
    private readonly review: VerificationReviewService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  queue(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(new ZodValidationPipe(verificationQueueQuerySchema)) query: VerificationQueueQuery,
  ) {
    return this.review.listQueue(actor, query);
  }

  @Get(":id/selfie")
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

  /**
   * The decision. Audited here and not with `@Audited()`: the row has to say
   * which gym and what was decided, and only the decision knows that. Written
   * after the commit; a failed decision writes nothing.
   */
  @Post(":id/decide")
  @HttpCode(200)
  async decide(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", UuidParamPipe) verificationId: string,
    @Body(new ZodValidationPipe(decideVerificationSchema)) input: DecideVerificationInput,
    @Req() request: Request,
  ) {
    const decided = await this.review.decide(actor, verificationId, input);
    await this.auditLog.record(actor, {
      domain: "verification",
      action: "decide",
      targetKind: "photo_verification",
      targetId: verificationId,
      metadata: { tenantId: decided.tenantId, decision: decided.decision, reason: decided.reason },
      ip: request.ip ?? null,
      userAgent: request.get("user-agent")?.slice(0, 500) ?? null,
    });
    return decided.submission;
  }
}
