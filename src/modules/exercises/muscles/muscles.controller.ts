import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { UuidParamPipe } from "../../../common/pipes/uuid-param.pipe";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../../common/types/auth-context.types";
import { MusclesService } from "./muscles.service";
import {
  ExercisePreferenceInput,
  exercisePreferenceSchema,
} from "./muscles.schemas";

/** Catálogo de grupos musculares y recomendaciones por grupo. */
@Controller("muscle-groups")
export class MuscleGroupsController {
  constructor(private readonly musclesService: MusclesService) {}

  @Get()
  listGroups() {
    return this.musclesService.listMuscleGroups();
  }

  @Get(":code/exercises")
  listExercisesByGroup(
    @Param("code") code: string,
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.musclesService.listExercisesByGroup(
      code,
      Math.min(Math.max(limit, 1), 100),
    );
  }
}

/** Catálogo de músculos específicos y búsqueda de ejercicios por músculo. */
@Controller("muscles")
export class MusclesCatalogController {
  constructor(private readonly musclesService: MusclesService) {}

  @Get()
  listMuscles() {
    return this.musclesService.listMuscles();
  }

  @Get(":code/exercises")
  listExercisesByMuscle(
    @Param("code") code: string,
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.musclesService.listExercisesByMuscle(
      code,
      Math.min(Math.max(limit, 1), 100),
    );
  }
}

/** Músculos trabajados, rating y recomendaciones de un ejercicio. */
@Controller("exercises")
export class ExerciseMusclesController {
  constructor(private readonly musclesService: MusclesService) {}

  @Get(":id/muscles")
  getExerciseMuscles(@Param("id", UuidParamPipe) exerciseId: string) {
    return this.musclesService.getExerciseMuscles(exerciseId);
  }

  @Get(":id/similar")
  getSimilarExercises(
    @Param("id", UuidParamPipe) exerciseId: string,
    @Query("limit", new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.musclesService.findSimilarExercises(
      exerciseId,
      Math.min(Math.max(limit, 1), 50),
    );
  }
}

/** Preferencia personal del usuario autenticado (me gusta / valoración). */
@Controller("me/exercises")
export class ExercisePreferencesController {
  constructor(private readonly musclesService: MusclesService) {}

  @Get("preferences")
  listMyPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.musclesService.listMyPreferences(user.id);
  }

  @Put(":id/preference")
  setPreference(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", UuidParamPipe) exerciseId: string,
    @Body(new ZodValidationPipe(exercisePreferenceSchema))
    input: ExercisePreferenceInput,
  ) {
    return this.musclesService.setPreference(user.id, exerciseId, input);
  }
}
