import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { WorkoutsService } from './workouts.service';
import {
  AddSessionExerciseInput,
  CreateWorkoutSessionInput,
  CreateWorkoutSetInput,
  UpdateSessionExerciseInput,
  UpdateWorkoutSetInput,
  WorkoutSessionListInput,
  addSessionExerciseSchema,
  createWorkoutSessionSchema,
  createWorkoutSetSchema,
  updateSessionExerciseSchema,
  updateWorkoutSetSchema,
  workoutSessionListSchema,
} from './workouts.schemas';

@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Post()
  startSession(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Body(new ZodValidationPipe(createWorkoutSessionSchema))
    input: CreateWorkoutSessionInput,
  ) {
    return this.workoutsService.startSession(authenticatedUser.id, input);
  }

  @Get()
  listMySessions(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Query(new ZodValidationPipe(workoutSessionListSchema))
    pagination: WorkoutSessionListInput,
  ) {
    return this.workoutsService.listMySessions(authenticatedUser.id, pagination);
  }

  @Get(':id')
  getMySession(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Param('id', UuidParamPipe) sessionId: string,
  ) {
    return this.workoutsService.getMySession(authenticatedUser.id, sessionId);
  }

  @Patch(':id/finish')
  finishSession(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Param('id', UuidParamPipe) sessionId: string,
  ) {
    return this.workoutsService.finishSession(authenticatedUser.id, sessionId);
  }

  @Patch(':id/cancel')
  cancelSession(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Param('id', UuidParamPipe) sessionId: string,
  ) {
    return this.workoutsService.cancelSession(authenticatedUser.id, sessionId);
  }

  @Post(':sessionId/exercises')
  addExerciseToSession(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Param('sessionId', UuidParamPipe) sessionId: string,
    @Body(new ZodValidationPipe(addSessionExerciseSchema))
    input: AddSessionExerciseInput,
  ) {
    return this.workoutsService.addExerciseToSession(
      authenticatedUser.id,
      sessionId,
      input,
    );
  }

  @Patch('session-exercises/:id')
  updateSessionExercise(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Param('id', UuidParamPipe) sessionExerciseId: string,
    @Body(new ZodValidationPipe(updateSessionExerciseSchema))
    input: UpdateSessionExerciseInput,
  ) {
    return this.workoutsService.updateSessionExercise(
      authenticatedUser.id,
      sessionExerciseId,
      input,
    );
  }

  @Delete('session-exercises/:id')
  deleteSessionExercise(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Param('id', UuidParamPipe) sessionExerciseId: string,
  ) {
    return this.workoutsService.deleteSessionExercise(
      authenticatedUser.id,
      sessionExerciseId,
    );
  }

  @Post('session-exercises/:id/sets')
  addSet(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Param('id', UuidParamPipe) sessionExerciseId: string,
    @Body(new ZodValidationPipe(createWorkoutSetSchema)) input: CreateWorkoutSetInput,
  ) {
    return this.workoutsService.addSet(
      authenticatedUser.id,
      sessionExerciseId,
      input,
    );
  }

  @Patch('sets/:id')
  updateSet(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Param('id', UuidParamPipe) setId: string,
    @Body(new ZodValidationPipe(updateWorkoutSetSchema)) input: UpdateWorkoutSetInput,
  ) {
    return this.workoutsService.updateSet(authenticatedUser.id, setId, input);
  }

  @Delete('sets/:id')
  deleteSet(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Param('id', UuidParamPipe) setId: string,
  ) {
    return this.workoutsService.deleteSet(authenticatedUser.id, setId);
  }
}
