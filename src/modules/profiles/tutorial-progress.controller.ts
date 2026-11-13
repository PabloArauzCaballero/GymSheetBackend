import { Body, Controller, Delete, Get, Param, Put } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import {
  TutorialProgressUpsertInput,
  tutorialIdSchema,
  tutorialProgressUpsertSchema,
} from "./tutorial-progress.schemas";
import { TutorialProgressService } from "./tutorial-progress.service";

/**
 * `GET/PUT/DELETE /me/tutorial-progress`: el contrato que la web ya consumía
 * (`apps/web/docs/tutorials.md`). Sin él, «Omitir» no sobrevivía a una recarga.
 */
@Controller("me/tutorial-progress")
export class TutorialProgressController {
  constructor(private readonly service: TutorialProgressService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.id);
  }

  @Put(":tutorialId")
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param("tutorialId", new ZodValidationPipe(tutorialIdSchema)) tutorialId: string,
    @Body(new ZodValidationPipe(tutorialProgressUpsertSchema)) input: TutorialProgressUpsertInput,
  ) {
    return this.service.upsert(user.id, tutorialId, input);
  }

  @Delete(":tutorialId")
  reset(
    @CurrentUser() user: AuthenticatedUser,
    @Param("tutorialId", new ZodValidationPipe(tutorialIdSchema)) tutorialId: string,
  ) {
    return this.service.reset(user.id, tutorialId);
  }
}
