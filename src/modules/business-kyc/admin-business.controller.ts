import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PLATFORM_MODERATION_ROLES } from "../../common/tenancy/tenant-scope";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { handleParamSchema } from "../business-accounts/business-accounts.schemas";
import { AuditLogService } from "../admin-access/audit-log.service";
import { requestTrace } from "./admin-business-kyc.controller";
import { BusinessAdminService } from "./business-admin.service";
import {
  AccountActionInput,
  AccountsQuery,
  BannedTermsInput,
  BlocklistEntryInput,
  accountActionSchema,
  accountsQuerySchema,
  bannedTermsSchema,
  blocklistEntrySchema,
  forceRenameSchema,
  handleReservationSchema,
} from "./kyc.schemas";

/** REPP operating business accounts (ADR-0021, plan §3.3). Every mutation is audited. */
@Roles(...PLATFORM_MODERATION_ROLES)
@Controller("admin/business")
export class AdminBusinessController {
  constructor(
    private readonly admin: BusinessAdminService,
    private readonly auditLog: AuditLogService,
  ) {}

  private audit(actor: AuthenticatedUser, request: Request, action: string, targetKind: string, targetId: string | null, metadata?: Record<string, unknown>) {
    return this.auditLog.record(actor, { domain: "business", action, targetKind, targetId, metadata, ...requestTrace(request) });
  }

  @Get("accounts")
  @Header("Cache-Control", "private, no-store")
  accounts(@Query(new ZodValidationPipe(accountsQuerySchema)) query: AccountsQuery) {
    return this.admin.listAccounts(query);
  }

  @Post("accounts/:id/suspend")
  @HttpCode(HttpStatus.OK)
  async suspend(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", UuidParamPipe) accountId: string,
    @Body(new ZodValidationPipe(accountActionSchema)) input: AccountActionInput,
    @Req() request: Request,
  ) {
    const result = await this.admin.suspend(actor, accountId, input);
    await this.audit(actor, request, "account-suspend", "business_account", accountId, { reasonCode: input.reasonCode });
    return result;
  }

  @Post("accounts/:id/reinstate")
  @HttpCode(HttpStatus.OK)
  async reinstate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", UuidParamPipe) accountId: string,
    @Body(new ZodValidationPipe(accountActionSchema)) input: AccountActionInput,
    @Req() request: Request,
  ) {
    const result = await this.admin.reinstate(actor, accountId, input);
    await this.audit(actor, request, "account-reinstate", "business_account", accountId, { reasonCode: input.reasonCode });
    return result;
  }

  @Post("handles/reservations")
  @HttpCode(HttpStatus.CREATED)
  async reserve(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(handleReservationSchema)) input: { handle: string; reason: string },
    @Req() request: Request,
  ) {
    const reserved = await this.admin.reserveHandle(input);
    await this.audit(actor, request, "handle-reserve", "handle", reserved.handle, { reason: input.reason });
    return reserved;
  }

  @Delete("handles/reservations/:handle")
  @HttpCode(HttpStatus.NO_CONTENT)
  async unreserve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("handle", new ZodValidationPipe(handleParamSchema)) handle: string,
    @Req() request: Request,
  ) {
    await this.admin.removeReservation(handle);
    await this.audit(actor, request, "handle-unreserve", "handle", handle);
  }

  @Post("handles/:handle/force-rename")
  @HttpCode(HttpStatus.OK)
  async forceRename(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("handle", new ZodValidationPipe(handleParamSchema)) handle: string,
    @Body(new ZodValidationPipe(forceRenameSchema)) input: { newHandle: string; reason: string },
    @Req() request: Request,
  ) {
    const renamed = await this.admin.forceRename(actor, handle, input);
    await this.audit(actor, request, "handle-force-rename", "handle", renamed.previous, { to: renamed.handle, reason: input.reason });
    return renamed;
  }

  @Get("blocklist")
  @Header("Cache-Control", "private, no-store")
  blocklist() {
    return this.admin.listBlocklist();
  }

  @Post("blocklist")
  @HttpCode(HttpStatus.CREATED)
  async addBlocklist(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(blocklistEntrySchema)) input: BlocklistEntryInput,
    @Req() request: Request,
  ) {
    const entry = await this.admin.addBlocklist(actor, input);
    await this.audit(actor, request, "blocklist-add", "blocklist_entry", entry.id, { kind: input.kind, reasonCode: input.reasonCode });
    return entry;
  }

  @Delete("blocklist/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeBlocklist(@CurrentUser() actor: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Req() request: Request) {
    await this.admin.removeBlocklist(actor, id);
    await this.audit(actor, request, "blocklist-remove", "blocklist_entry", id);
  }

  @Get("banned-terms")
  @Header("Cache-Control", "private, no-store")
  bannedTerms() {
    return this.admin.listBannedTerms();
  }

  @Put("banned-terms")
  async replaceBannedTerms(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(bannedTermsSchema)) input: BannedTermsInput,
    @Req() request: Request,
  ) {
    const terms = await this.admin.replaceBannedTerms(actor, input);
    await this.audit(actor, request, "banned-terms-replace", "banned_terms", null, { count: terms.terms.length });
    return terms;
  }
}
