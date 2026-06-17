import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { ExercisesService } from './exercises.service';
import {
  CreateGlobalExerciseInput,
  CreatePersonalExerciseInput,
  ExerciseFilterInput,
  UpdateExerciseInput,
  createGlobalExerciseSchema,
  createPersonalExerciseSchema,
  exerciseFilterSchema,
  updateExerciseSchema,
} from './exercises.schemas';

@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get()
  listExercises(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query(new ZodValidationPipe(exerciseFilterSchema)) filters: ExerciseFilterInput,
  ) {
    return this.exercisesService.listVisibleForUser(currentUser.id, filters);
  }

  @Get(':id')
  getExercise(@CurrentUser() currentUser: AuthenticatedUser, @Param('id') id: string) {
    return this.exercisesService.getVisibleExerciseOrFail(id, currentUser.id);
  }

  @Post('personal')
  createPersonalExercise(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body(new ZodValidationPipe(createPersonalExerciseSchema)) input: CreatePersonalExerciseInput,
  ) {
    return this.exercisesService.createPersonalExercise(currentUser.id, input);
  }

  @Patch(':id')
  updatePersonalExercise(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateExerciseSchema)) input: UpdateExerciseInput,
  ) {
    return this.exercisesService.updatePersonalExercise(currentUser.id, id, input);
  }

  @Delete(':id')
  inactivatePersonalExercise(@CurrentUser() currentUser: AuthenticatedUser, @Param('id') id: string) {
    return this.exercisesService.inactivatePersonalExercise(currentUser.id, id);
  }
}

@Roles(UserRole.ADMIN)
@Controller('admin/exercises/global')
export class AdminExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Post()
  createGlobalExercise(@Body(new ZodValidationPipe(createGlobalExerciseSchema)) input: CreateGlobalExerciseInput) {
    return this.exercisesService.createGlobalExercise(input);
  }

  @Patch(':id')
  updateGlobalExercise(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateExerciseSchema)) input: UpdateExerciseInput,
  ) {
    return this.exercisesService.updateGlobalExercise(id, input);
  }

  @Delete(':id')
  inactivateGlobalExercise(@Param('id') id: string) {
    return this.exercisesService.inactivateGlobalExercise(id);
  }
}

@Controller('user-exercises')
export class UserExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get()
  listFavorites(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.exercisesService.listFavorites(currentUser.id);
  }

  @Post(':exerciseId')
  addFavorite(@CurrentUser() currentUser: AuthenticatedUser, @Param('exerciseId') exerciseId: string) {
    return this.exercisesService.addFavorite(currentUser.id, exerciseId);
  }

  @Delete(':exerciseId')
  removeFavorite(@CurrentUser() currentUser: AuthenticatedUser, @Param('exerciseId') exerciseId: string) {
    return this.exercisesService.removeFavorite(currentUser.id, exerciseId);
  }
}
