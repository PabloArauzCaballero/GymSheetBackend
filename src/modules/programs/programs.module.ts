import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BusinessDateService } from '../../common/time/business-date.service';
import { ExercisesModule } from '../exercises/exercises.module';
import { WorkoutsModule } from '../workouts/workouts.module';
import { ProgramRoutineChangesService } from './program-routine-changes.service';
import { ProgramSessionController } from './program-session.controller';
import { ProgramSessionService } from './program-session.service';
import { TrainingModule } from '../training/training.module';
import {
  ProgramLiftTargetModel,
  ProgramWeekModel,
  TrainingProgramModel,
} from './program.models';
import { ProgramsActivationService } from './programs-activation.service';
import { ProgramsController } from './programs.controller';
import { ProgramsLifecycleService } from './programs-lifecycle.service';
import { ProgramsQueryService } from './programs-query.service';
import { ProgramsRepository } from './programs.repository';

@Module({
  imports: [
    SequelizeModule.forFeature([TrainingProgramModel, ProgramLiftTargetModel, ProgramWeekModel]),
    TrainingModule,
    WorkoutsModule,
    ExercisesModule,
  ],
  controllers: [ProgramsController, ProgramSessionController],
  providers: [
    BusinessDateService,
    ProgramsRepository,
    ProgramsQueryService,
    ProgramsActivationService,
    ProgramsLifecycleService,
    ProgramSessionService,
    ProgramRoutineChangesService,
  ],
  exports: [ProgramsRepository, ProgramsQueryService],
})
export class ProgramsModule {}
