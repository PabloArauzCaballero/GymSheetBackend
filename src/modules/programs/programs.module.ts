import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BusinessDateService } from '../../common/time/business-date.service';
import { CardioController } from './cardio.controller';
import { CardioPlanModel } from './cardio-plan.model';
import { CardioPlansService } from './cardio-plans.service';
import { ProgramWeekCloseService } from './program-week-close.service';
import { ProgramsCardioService } from './programs-cardio.service';
import { RewardLedgerRepository } from './reward-ledger.repository';
import { SupportTrainingController } from './support-training.controller';
import { SupportTrainingService } from './support-training.service';
import { ProductEvents } from '../../common/tracking/product-events';
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
    SequelizeModule.forFeature([
      TrainingProgramModel,
      ProgramLiftTargetModel,
      ProgramWeekModel,
      CardioPlanModel,
    ]),
    TrainingModule,
    WorkoutsModule,
    ExercisesModule,
  ],
  controllers: [ProgramsController, ProgramSessionController, CardioController, SupportTrainingController],
  providers: [
    BusinessDateService,
    ProductEvents,
    ProgramsRepository,
    ProgramsQueryService,
    ProgramsActivationService,
    ProgramsLifecycleService,
    ProgramSessionService,
    ProgramRoutineChangesService,
    CardioPlansService,
    ProgramsCardioService,
    RewardLedgerRepository,
    ProgramWeekCloseService,
    SupportTrainingService,
  ],
  exports: [ProgramsRepository, ProgramsQueryService, ProgramWeekCloseService, RewardLedgerRepository],
})
export class ProgramsModule {}
