import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
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
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Query(new ZodValidationPipe(exerciseFilterSchema)) filters: ExerciseFilterInput,
  ) {
    return this.exercisesService.listVisibleForUser(authenticatedUser.id, filters);
  }

  @Get(':id')
  getExercise(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Param('id', UuidParamPipe) exerciseId: string,
  ) {
    return this.exercisesService.getVisibleExerciseOrFail(exerciseId, authenticatedUser.id);
  }

  @Post('personal')
  createPersonalExercise(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Body(new ZodValidationPipe(createPersonalExerciseSchema))
    input: CreatePersonalExerciseInput,
  ) {
    return this.exercisesService.createPersonalExercise(authenticatedUser.id, input);
  }

  @Patch(':id')
  updatePersonalExercise(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Param('id', UuidParamPipe) exerciseId: string,
    @Body(new ZodValidationPipe(updateExerciseSchema)) input: UpdateExerciseInput,
  ) {
    return this.exercisesService.updatePersonalExercise(
      authenticatedUser.id,
      exerciseId,
      input,
    );
  }

  @Delete(':id')
  inactivatePersonalExercise(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Param('id', UuidParamPipe) exerciseId: string,
  ) {
    return this.exercisesService.inactivatePersonalExercise(
      authenticatedUser.id,
      exerciseId,
    );
  }
}

@Roles(UserRole.ADMIN)
@Controller('admin/exercises/global')
export class AdminExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Post()
  createGlobalExercise(
    @Body(new ZodValidationPipe(createGlobalExerciseSchema)) input: CreateGlobalExerciseInput,
  ) {
    return this.exercisesService.createGlobalExercise(input);
  }

  @Patch(':id')
  updateGlobalExercise(
    @Param('id', UuidParamPipe) exerciseId: string,
    @Body(new ZodValidationPipe(updateExerciseSchema)) input: UpdateExerciseInput,
  ) {
    return this.exercisesService.updateGlobalExercise(exerciseId, input);
  }

  @Delete(':id')
  inactivateGlobalExercise(@Param('id', UuidParamPipe) exerciseId: string) {
    return this.exercisesService.inactivateGlobalExercise(exerciseId);
  }
}

@Controller('user-exercises')
export class UserExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get()
  listFavorites(@CurrentUser() authenticatedUser: AuthenticatedUser) {
    return this.exercisesService.listFavorites(authenticatedUser.id);
  }

  @Post(':exerciseId')
  addFavorite(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Param('exerciseId', UuidParamPipe) exerciseId: string,
  ) {
    return this.exercisesService.addFavorite(authenticatedUser.id, exerciseId);
  }

  @Delete(':exerciseId')
  removeFavorite(
    @CurrentUser() authenticatedUser: AuthenticatedUser,
    @Param('exerciseId', UuidParamPipe) exerciseId: string,
  ) {
    return this.exercisesService.removeFavorite(authenticatedUser.id, exerciseId);
  }
}
