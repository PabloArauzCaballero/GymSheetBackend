import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequiresVerifiedEmail } from "../../common/decorators/requires-verified-email.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../../common/enums/domain.enums";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
import { ConsentsService } from "../consents/consents.service";
import { legalClientContext } from "../legal/legal-client-context";
import { UploadedSelfie } from "../verification/selfie-image";
import { KycDraftsService } from "./kyc-drafts.service";
import { KycStatusService } from "./kyc-status.service";
import { KycSubmitService } from "./kyc-submit.service";
import { KYC_RULES, KycDocumentKind } from "./kyc.catalog";
import { KycDraftInput, kycConsentSchema, kycDocumentBodySchema, kycDraftSchema, phoneConfirmSchema, phoneRequestSchema } from "./kyc.schemas";
import { PhoneVerificationService } from "./phone/phone-verification.service";

const ttl = env.RATE_LIMIT_TTL_SECONDS * 1000;

/** The business's own KYC (ADR-0021), wizard steps 4–7 and the result. Persons get 403. */
@Roles(UserRole.BUSINESS)
@RequiresVerifiedEmail()
@Controller("business/me")
export class BusinessKycController {
  constructor(
    private readonly status: KycStatusService,
    private readonly drafts: KycDraftsService,
    private readonly submits: KycSubmitService,
    private readonly phones: PhoneVerificationService,
    private readonly consents: ConsentsService,
  ) {}

  @Post("phone/verify/request")
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: env.AUTH_RATE_LIMIT_MAX, ttl } })
  async requestPhone(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(phoneRequestSchema)) body: { phone: string }) {
    await this.drafts.requireAccount(user.id);
    return this.phones.request(user.id, body.phone);
  }

  @Post("phone/verify/confirm")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: env.AUTH_RATE_LIMIT_MAX, ttl } })
  async confirmPhone(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(phoneConfirmSchema)) body: { code: string }) {
    await this.drafts.requireAccount(user.id);
    return this.phones.confirm(user.id, body.code);
  }

  @Get("kyc")
  @Header("Cache-Control", "private, no-store")
  state(@CurrentUser() user: AuthenticatedUser) {
    return this.status.state(user.id);
  }

  @Put("kyc/draft")
  @Header("Cache-Control", "private, no-store")
  saveDraft(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(kycDraftSchema)) input: KycDraftInput) {
    return this.drafts.saveDraft(user.id, input);
  }

  /** The separate KYC_SELFIE consent (ADR-0014 pattern), given before the selfie challenge. */
  @Put("kyc/consent")
  async consent(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(kycConsentSchema)) input: { granted: boolean; version?: string },
    @Req() request: Request,
  ) {
    return this.consents.set(user.id, "KYC_SELFIE", input, legalClientContext(request).channel);
  }

  @Post("kyc/selfie-challenge")
  @HttpCode(HttpStatus.CREATED)
  selfieChallenge(@CurrentUser() user: AuthenticatedUser) {
    return this.drafts.issueSelfieChallenge(user.id);
  }

  @Post("kyc/documents")
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: KYC_RULES.documentMaxBytes, files: 1 } }))
  uploadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedSelfie | undefined,
    @Body(new ZodValidationPipe(kycDocumentBodySchema)) body: { kind: KycDocumentKind },
  ) {
    return this.drafts.uploadDocument(user.id, body.kind, file);
  }

  @Delete("kyc/documents/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDocument(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) documentId: string) {
    await this.drafts.deleteDocument(user.id, documentId);
  }

  @Post("kyc/submit")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: env.AUTH_RATE_LIMIT_MAX, ttl } })
  submit(@CurrentUser() user: AuthenticatedUser) {
    return this.submits.submit(user.id);
  }

  @Post("kyc/resubmit")
  @HttpCode(HttpStatus.CREATED)
  resubmit(@CurrentUser() user: AuthenticatedUser) {
    return this.submits.resubmit(user.id);
  }

  /** Material change of an approved business: a new version reviewed by REPP. */
  @Post("kyc/changes")
  @HttpCode(HttpStatus.CREATED)
  startChange(@CurrentUser() user: AuthenticatedUser) {
    return this.submits.startChange(user.id);
  }
}
