import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
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
  LeaderboardQuery,
  UpdateBadgeInput,
  UpdateLevelInput,
  createBadgeSchema,
  createLevelSchema,
  leaderboardQuerySchema,
  updateBadgeSchema,
  updateLevelSchema,
} from "./progression.schemas";

/** La senda del usuario autenticado. */
@Controller("me/progression")
export class ProgressionController {
  constructor(private readonly progressionService: ProgressionService) {}

  @Get()
  getMyProgression(@CurrentUser() user: AuthenticatedUser) {
    return this.progressionService.getProgression(user.id);
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
    return this.progressionService.getLeaderboard(user.id, query.limit);
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
  listLevels() {
    return this.adminService.listLevels();
  }

  @Post("levels")
  createLevel(
    @Body(new ZodValidationPipe(createLevelSchema)) input: CreateLevelInput,
  ) {
    return this.adminService.createLevel(input);
  }

  @Patch("levels/:id")
  updateLevel(
    @Param("id", UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateLevelSchema)) input: UpdateLevelInput,
  ) {
    return this.adminService.updateLevel(id, input);
  }

  @Delete("levels/:id")
  deactivateLevel(@Param("id", UuidParamPipe) id: string) {
    return this.adminService.deactivateLevel(id);
  }

  @Get("badges")
  listBadges() {
    return this.adminService.listBadges();
  }

  @Post("badges")
  createBadge(
    @Body(new ZodValidationPipe(createBadgeSchema)) input: CreateBadgeInput,
  ) {
    return this.adminService.createBadge(input);
  }

  @Patch("badges/:id")
  updateBadge(
    @Param("id", UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateBadgeSchema)) input: UpdateBadgeInput,
  ) {
    return this.adminService.updateBadge(id, input);
  }

  @Delete("badges/:id")
  deactivateBadge(@Param("id", UuidParamPipe) id: string) {
    return this.adminService.deactivateBadge(id);
  }
}
