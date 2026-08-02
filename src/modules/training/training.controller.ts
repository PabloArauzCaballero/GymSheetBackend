import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { TrainingService } from './training.service';
import {
  RoutineExerciseInput,
  AssignRoutineInput,
  CreateRoutineInput,
  ImportRoutinesInput,
  ListRoutinesInput,
  UpdateRoutineExerciseInput,
  UpdateRoutineInput,
  addRoutineExerciseSchema,
  assignRoutineSchema,
  createRoutineSchema,
  importRoutinesSchema,
  listRoutinesSchema,
  updateRoutineExerciseSchema,
  updateRoutineSchema,
} from './training.schemas';

@Controller('routines')
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createRoutineSchema)) input: CreateRoutineInput,
  ) {
    return this.trainingService.createRoutine(user, input);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listRoutinesSchema)) query: ListRoutinesInput,
  ) {
    return this.trainingService.listRoutines(user.id, query);
  }

  @Get('assignments/me')
  myAssignments(@CurrentUser() user: AuthenticatedUser) {
    return this.trainingService.listMyAssignments(user.id);
  }

  @Roles(UserRole.COACH, UserRole.ADMIN)
  @Get('assignments/coach')
  coachAssignments(@CurrentUser() user: AuthenticatedUser) {
    return this.trainingService.listCoachAssignments(user.id);
  }

  @Post('import')
  import(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(importRoutinesSchema)) input: ImportRoutinesInput,
  ) {
    return this.trainingService.importRoutines(user, input);
  }

  @Patch('exercises/:id')
  updateExercise(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) routineExerciseId: string,
    @Body(new ZodValidationPipe(updateRoutineExerciseSchema))
    input: UpdateRoutineExerciseInput,
  ) {
    return this.trainingService.updateExercise(user, routineExerciseId, input);
  }

  @Delete('exercises/:id')
  deleteExercise(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) routineExerciseId: string,
  ) {
    return this.trainingService.deleteExercise(user, routineExerciseId);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) routineId: string,
  ) {
    return this.trainingService.getRoutineForUser(user, routineId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) routineId: string,
    @Body(new ZodValidationPipe(updateRoutineSchema)) input: UpdateRoutineInput,
  ) {
    return this.trainingService.updateRoutine(user, routineId, input);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) routineId: string,
  ) {
    return this.trainingService.deleteRoutine(user, routineId);
  }

  @Post(':id/exercises')
  addExercise(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) routineId: string,
    @Body(new ZodValidationPipe(addRoutineExerciseSchema)) input: RoutineExerciseInput,
  ) {
    return this.trainingService.addExercise(user, routineId, input);
  }

  @Roles(UserRole.COACH, UserRole.ADMIN)
  @Post(':id/assign')
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) routineId: string,
    @Body(new ZodValidationPipe(assignRoutineSchema)) input: AssignRoutineInput,
  ) {
    return this.trainingService.assignRoutine(user, routineId, input);
  }

  @Post(':id/start')
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) routineId: string,
  ) {
    return this.trainingService.startSessionFromRoutine(user, routineId);
  }
}
