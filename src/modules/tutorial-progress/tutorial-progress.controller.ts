import { Body, Controller, Delete, Get, Param, Put } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import {
  TutorialProgressUpsertInput,
  tutorialIdParamSchema,
  tutorialProgressUpsertSchema,
} from "./tutorial-progress.schemas";
import { TutorialProgressService } from "./tutorial-progress.service";

/**
 * El dueño del progreso sale SIEMPRE del JWT, nunca de la ruta ni del cuerpo:
 * no hay forma de leer ni escribir el progreso de otra persona.
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
    @Param("tutorialId", new ZodValidationPipe(tutorialIdParamSchema)) tutorialId: string,
    @Body(new ZodValidationPipe(tutorialProgressUpsertSchema)) input: TutorialProgressUpsertInput,
  ) {
    return this.service.upsert(user.id, tutorialId, input);
  }

  @Delete(":tutorialId")
  reset(
    @CurrentUser() user: AuthenticatedUser,
    @Param("tutorialId", new ZodValidationPipe(tutorialIdParamSchema)) tutorialId: string,
  ) {
    return this.service.reset(user.id, tutorialId);
  }
}
