import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
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
  SelfScheduleRoutineInput,
  CreateRoutineInput,
  CreateCompleteRoutineInput,
  CopyRoutineInput,
  RecommendRoutineInput,
  ImportRoutinesInput,
  ListRoutinesInput,
  UpdateRoutineExerciseInput,
  UpdateRoutineInput,
  addRoutineExerciseSchema,
  assignRoutineSchema,
  selfScheduleRoutineSchema,
  createRoutineSchema,
  createCompleteRoutineSchema,
  copyRoutineSchema,
  recommendRoutineSchema,
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

  @Post('complete')
  createComplete(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createCompleteRoutineSchema)) input: CreateCompleteRoutineInput,
  ) {
    return this.trainingService.createCompleteRoutine(user, input);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listRoutinesSchema)) query: ListRoutinesInput,
  ) {
    return this.trainingService.listRoutines(user, query);
  }

  @Get('recommendations')
  recommendations(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(recommendRoutineSchema)) input: RecommendRoutineInput,
  ) {
    return this.trainingService.recommendRoutine(user.id, input);
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

  @Post(':id/copy')
  copy(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) routineId: string,
    @Body(new ZodValidationPipe(copyRoutineSchema)) input: CopyRoutineInput,
  ) {
    return this.trainingService.copyRoutine(user, routineId, input);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) routineId: string,
    @Body(new ZodValidationPipe(updateRoutineSchema)) input: UpdateRoutineInput,
  ) {
    return this.trainingService.updateRoutine(user, routineId, input);
  }

  @Put(':id/complete')
  replaceComplete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) routineId: string,
    @Body(new ZodValidationPipe(createCompleteRoutineSchema)) input: CreateCompleteRoutineInput,
  ) {
    return this.trainingService.replaceCompleteRoutine(user, routineId, input);
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

  /**
   * Programación propia. Vive fuera del bloque COACH/ADMIN a propósito: la
   * agenda que se toca es la de quien llama, no la de un tercero.
   */
  @Post(':id/schedule')
  selfSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) routineId: string,
    @Body(new ZodValidationPipe(selfScheduleRoutineSchema))
    input: SelfScheduleRoutineInput,
  ) {
    return this.trainingService.selfScheduleRoutine(user, routineId, input);
  }

  @Post(':id/start')
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) routineId: string,
  ) {
    return this.trainingService.startSessionFromRoutine(user, routineId);
  }
}
