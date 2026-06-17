import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { WorkoutsService } from './workouts.service';
import {
  AddSessionExerciseInput,
  CreateWorkoutSessionInput,
  CreateWorkoutSetInput,
  UpdateSessionExerciseInput,
  UpdateWorkoutSetInput,
  addSessionExerciseSchema,
  createWorkoutSessionSchema,
  createWorkoutSetSchema,
  updateSessionExerciseSchema,
  updateWorkoutSetSchema,
} from './workouts.schemas';

@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Post()
  startSession(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body(new ZodValidationPipe(createWorkoutSessionSchema)) input: CreateWorkoutSessionInput,
  ) {
    return this.workoutsService.startSession(currentUser.id, input);
  }

  @Get()
  listMySessions(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.workoutsService.listMySessions(currentUser.id);
  }

  @Get(':id')
  getMySession(@CurrentUser() currentUser: AuthenticatedUser, @Param('id') id: string) {
    return this.workoutsService.getMySession(currentUser.id, id);
  }

  @Patch(':id/finish')
  finishSession(@CurrentUser() currentUser: AuthenticatedUser, @Param('id') id: string) {
    return this.workoutsService.finishSession(currentUser.id, id);
  }

  @Patch(':id/cancel')
  cancelSession(@CurrentUser() currentUser: AuthenticatedUser, @Param('id') id: string) {
    return this.workoutsService.cancelSession(currentUser.id, id);
  }

  @Post(':sessionId/exercises')
  addExerciseToSession(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(addSessionExerciseSchema)) input: AddSessionExerciseInput,
  ) {
    return this.workoutsService.addExerciseToSession(currentUser.id, sessionId, input);
  }

  @Patch('session-exercises/:id')
  updateSessionExercise(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSessionExerciseSchema)) input: UpdateSessionExerciseInput,
  ) {
    return this.workoutsService.updateSessionExercise(currentUser.id, id, input);
  }

  @Delete('session-exercises/:id')
  deleteSessionExercise(@CurrentUser() currentUser: AuthenticatedUser, @Param('id') id: string) {
    return this.workoutsService.deleteSessionExercise(currentUser.id, id);
  }

  @Post('session-exercises/:id/sets')
  addSet(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createWorkoutSetSchema)) input: CreateWorkoutSetInput,
  ) {
    return this.workoutsService.addSet(currentUser.id, id, input);
  }

  @Patch('sets/:id')
  updateSet(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWorkoutSetSchema)) input: UpdateWorkoutSetInput,
  ) {
    return this.workoutsService.updateSet(currentUser.id, id, input);
  }

  @Delete('sets/:id')
  deleteSet(@CurrentUser() currentUser: AuthenticatedUser, @Param('id') id: string) {
    return this.workoutsService.deleteSet(currentUser.id, id);
  }
}
