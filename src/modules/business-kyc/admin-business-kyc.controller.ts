import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, Req, StreamableFile } from "@nestjs/common";
import type { Request } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PLATFORM_MODERATION_ROLES } from "../../common/tenancy/tenant-scope";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { AuditLogService } from "../admin-access/audit-log.service";
import { KycReviewService } from "./kyc-review.service";
import { KycDecisionInput, KycQueueQuery, kycDecisionSchema, kycQueueQuerySchema } from "./kyc.schemas";

/** Who, from where: the parts of an audit row the request knows. */
export function requestTrace(request: Request): { ip: string | null; userAgent: string | null } {
  return { ip: request.ip ?? null, userAgent: request.get("user-agent")?.slice(0, 500) ?? null };
}

/**
 * REPP's KYC console (ADR-0021, plan §2.7): central team only
 * (`PLATFORM_MODERATION_ROLES`). A gym account, a business or a member gets
 * 403. Reading identity data in clear and every document view leave their own
 * audit row, written before the bytes are returned.
 */
@Roles(...PLATFORM_MODERATION_ROLES)
@Controller("admin/business/kyc")
export class AdminBusinessKycController {
  constructor(
    private readonly review: KycReviewService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get("queue")
  @Header("Cache-Control", "private, no-store")
  queue(@Query(new ZodValidationPipe(kycQueueQuerySchema)) query: KycQueueQuery) {
    return this.review.queue(query);
  }

  @Get(":submissionId")
  @Header("Cache-Control", "private, no-store")
  async detail(@CurrentUser() actor: AuthenticatedUser, @Param("submissionId", UuidParamPipe) submissionId: string, @Req() request: Request) {
    const detail = await this.review.detail(actor, submissionId);
    await this.auditLog.record(actor, {
      domain: "business",
      action: "kyc-detail-view",
      targetKind: "kyc_submission",
      targetId: submissionId,
      metadata: { accountId: detail.account.id },
      ...requestTrace(request),
    });
    return detail;
  }

  @Get(":submissionId/documents/:documentId")
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  async document(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("submissionId", UuidParamPipe) submissionId: string,
    @Param("documentId", UuidParamPipe) documentId: string,
    @Req() request: Request,
  ): Promise<StreamableFile> {
    const media = await this.review.readDocument(actor, submissionId, documentId);
    await this.auditLog.record(actor, {
      domain: "business",
      action: "kyc-document-view",
      targetKind: "kyc_document",
      targetId: documentId,
      metadata: { submissionId },
      ...requestTrace(request),
    });
    return new StreamableFile(media.buffer, { type: media.mimeType, disposition: "inline" });
  }

  @Post(":submissionId/claim")
  @HttpCode(HttpStatus.OK)
  async claim(@CurrentUser() actor: AuthenticatedUser, @Param("submissionId", UuidParamPipe) submissionId: string, @Req() request: Request) {
    const claimed = await this.review.claim(actor, submissionId);
    await this.auditLog.record(actor, { domain: "business", action: "kyc-claim", targetKind: "kyc_submission", targetId: submissionId, ...requestTrace(request) });
    return claimed;
  }

  @Post(":submissionId/release")
  @HttpCode(HttpStatus.OK)
  async release(@CurrentUser() actor: AuthenticatedUser, @Param("submissionId", UuidParamPipe) submissionId: string, @Req() request: Request) {
    await this.review.release(actor, submissionId);
    await this.auditLog.record(actor, { domain: "business", action: "kyc-release", targetKind: "kyc_submission", targetId: submissionId, ...requestTrace(request) });
    return { released: true };
  }

  @Post(":submissionId/decide")
  @HttpCode(HttpStatus.OK)
  async decide(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("submissionId", UuidParamPipe) submissionId: string,
    @Body(new ZodValidationPipe(kycDecisionSchema)) input: KycDecisionInput,
    @Req() request: Request,
  ) {
    const decided = await this.review.decide(actor, submissionId, input);
    await this.auditLog.record(actor, {
      domain: "business",
      action: "kyc-decide",
      targetKind: "kyc_submission",
      targetId: submissionId,
      metadata: { decision: input.decision, reasonCodes: input.reasonCodes, allowResubmit: input.allowResubmit ?? null, status: decided.status },
      ...requestTrace(request),
    });
    return decided;
  }
}
