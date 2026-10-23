import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import {
  AlternativesQueryInput,
  StartFreeWorkoutInput,
  alternativesQuerySchema,
  startFreeWorkoutSchema,
} from './free-workout.schemas';
import { FreeWorkoutService } from './free-workout.service';

/** Rutina libre por zonas y equivalentes de un ejercicio de la sesión. */
@Controller('workouts')
export class FreeWorkoutController {
  constructor(private readonly freeWorkout: FreeWorkoutService) {}

  @Post('libre')
  startFree(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(startFreeWorkoutSchema)) input: StartFreeWorkoutInput,
  ) {
    return this.freeWorkout.startFree(user.id, input);
  }

  @Get('session-exercises/:id/alternatives')
  alternatives(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) sessionExerciseId: string,
    @Query(new ZodValidationPipe(alternativesQuerySchema)) query: AlternativesQueryInput,
  ) {
    return this.freeWorkout.listAlternatives(user.id, sessionExerciseId, query);
  }
}
