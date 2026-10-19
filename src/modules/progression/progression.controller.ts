import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../../common/enums/domain.enums";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { ProgressionAdminService } from "./progression-admin.service";
import { ProgressionService } from "./progression.service";
import {
  CreateBadgeInput,
  CreateLevelInput,
  CreatePrizeInput,
  LeaderboardQuery,
  RedeemPrizeInput,
  RestDaysInput,
  UpdateBadgeInput,
  UpdateLevelInput,
  UpdatePrizeInput,
  createBadgeSchema,
  createLevelSchema,
  createPrizeSchema,
  leaderboardQuerySchema,
  redeemPrizeSchema,
  restDaysSchema,
  updateBadgeSchema,
  updateLevelSchema,
  updatePrizeSchema,
} from "./progression.schemas";

/** La senda del usuario autenticado. */
@Controller("me/progression")
export class ProgressionController {
  constructor(private readonly progressionService: ProgressionService) {}

  @Get()
  getMyProgression(@CurrentUser() user: AuthenticatedUser) {
    return this.progressionService.getProgression(user.id);
  }

  /** Cuánto vale cada cosa, para que la pantalla lo explique con las cifras reales. */
  @Get("rules")
  getRules() {
    return this.progressionService.getRules();
  }

  /** Los cupones del socio («Mis premios»): lo mismo que `progression.prizes`. */
  @Get("prizes")
  getMyPrizes(@CurrentUser() user: AuthenticatedUser) {
    return this.progressionService.getPrizes(user.id);
  }

  /** El cliente confirma que ya ha celebrado las novedades. */
  @Post("acknowledge")
  acknowledge(@CurrentUser() user: AuthenticatedUser) {
    return this.progressionService.acknowledge(user.id);
  }

  @Get("leaderboard")
  getLeaderboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(leaderboardQuerySchema)) query: LeaderboardQuery,
  ) {
    return this.progressionService.getLeaderboard(user.id, query.limit, query.sortBy);
  }

  @Get("rest-days")
  getRestDays(@CurrentUser() user: AuthenticatedUser) {
    return this.progressionService.getRestDays(user.id);
  }

  @Patch("rest-days")
  setRestDays(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(restDaysSchema)) input: RestDaysInput,
  ) {
    return this.progressionService.setRestDays(user.id, input.weekdays);
  }

  /**
   * Canjea 150 puntos acumulados por un strike mensual adicional para proteger la racha.
   */
  @Post("strikes/buy")
  buyStrike(@CurrentUser() user: AuthenticatedUser) {
    return this.progressionService.buyStrike(user.id);
  }
}

/**
 * Catálogo editable por el gimnasio.
 *
 * Todavía no hay pantalla que consuma esto; el encargo era dejarlo hecho y
 * sembrado. Está completo a propósito —altas, ediciones y retiradas— para que
 * la interfaz de administración se construya sin volver aquí.
 */
@Roles(UserRole.ADMIN)
@Controller("admin/progression")
export class ProgressionAdminController {
  constructor(private readonly adminService: ProgressionAdminService) {}

  @Get("levels")
  listLevels(@CurrentUser() actor: AuthenticatedUser) {
    return this.adminService.listLevels(actor);
  }

  @Post("levels")
  createLevel(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(createLevelSchema)) input: CreateLevelInput,
  ) {
    return this.adminService.createLevel(actor, input);
  }

  @Patch("levels/:id")
  updateLevel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateLevelSchema)) input: UpdateLevelInput,
  ) {
    return this.adminService.updateLevel(actor, id, input);
  }

  @Delete("levels/:id")
  deactivateLevel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", UuidParamPipe) id: string,
  ) {
    return this.adminService.deactivateLevel(actor, id);
  }

  @Get("badges")
  listBadges(@CurrentUser() actor: AuthenticatedUser) {
    return this.adminService.listBadges(actor);
  }

  @Post("badges")
  createBadge(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(createBadgeSchema)) input: CreateBadgeInput,
  ) {
    return this.adminService.createBadge(actor, input);
  }

  @Patch("badges/:id")
  updateBadge(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateBadgeSchema)) input: UpdateBadgeInput,
  ) {
    return this.adminService.updateBadge(actor, id, input);
  }

  @Delete("badges/:id")
  deactivateBadge(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", UuidParamPipe) id: string,
  ) {
    return this.adminService.deactivateBadge(actor, id);
  }

  // ─────────────────────────────────────────── premios (P1, 2026-10-18)

  @Get("prizes")
  listPrizes(@CurrentUser() actor: AuthenticatedUser) {
    return this.adminService.listPrizes(actor);
  }

  @Post("prizes")
  createPrize(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(createPrizeSchema)) input: CreatePrizeInput,
  ) {
    return this.adminService.createPrize(actor, input);
  }

  /** Canje en recepción. Declarada antes que `prizes/:id` por claridad; los métodos ya difieren. */
  @Post("prizes/redeem")
  @HttpCode(200)
  redeemPrize(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(redeemPrizeSchema)) input: RedeemPrizeInput,
  ) {
    return this.adminService.redeemPrize(actor, input.code);
  }

  @Patch("prizes/:id")
  updatePrize(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updatePrizeSchema)) input: UpdatePrizeInput,
  ) {
    return this.adminService.updatePrize(actor, id, input);
  }

  @Delete("prizes/:id")
  deactivatePrize(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", UuidParamPipe) id: string,
  ) {
    return this.adminService.deactivatePrize(actor, id);
  }
}
