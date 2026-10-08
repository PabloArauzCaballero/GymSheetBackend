import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ExerciseModel } from '../exercises/exercise.model';
import { ExercisesModule } from '../exercises/exercises.module';
import { UserModel } from '../users/user.model';
import { WorkoutsModule } from '../workouts/workouts.module';
import { RoutineAssignmentModel } from './routine-assignment.model';
import { RoutineDayModel } from './routine-day.model';
import { RoutineShareModel } from './routine-share.model';
import { RoutineWeekOverrideModel } from './routine-week-override.model';
import { RoutineExerciseModel } from './routine-exercise.model';
import { RoutineModel } from './routine.model';
import { NotificationsModule } from '../notifications/notifications.module';
import { RoutineNotifier } from './routine-notifier';
import { RoutinePublicationController } from './routine-publication.controller';
import { RoutinePublicationService } from './routine-publication.service';
import { RoutineSharesRepository } from './routine-shares.repository';
import { RoutineSharingController } from './routine-sharing.controller';
import { RoutineSharingService } from './routine-sharing.service';
import { RoutineAccessService } from './routine-access.service';
import { RoutineDaysRepository } from './routine-days.repository';
import { RoutineCatalogRepository } from './routine-catalog.repository';
import { RoutineCatalogService } from './routine-catalog.service';
import { RoutineStructureService } from './routine-structure.service';
import { TrainingController } from './training.controller';
import { TrainingRepository } from './training.repository';
import { TrainingService } from './training.service';

@Module({
  imports: [
    SequelizeModule.forFeature([
      RoutineModel,
      RoutineExerciseModel,
      RoutineAssignmentModel,
      RoutineDayModel,
      RoutineShareModel,
      RoutineWeekOverrideModel,
      ExerciseModel,
      UserModel,
    ]),
    ExercisesModule,
    WorkoutsModule,
    NotificationsModule,
  ],
  controllers: [TrainingController, RoutinePublicationController, RoutineSharingController],
  providers: [
    TrainingRepository,
    TrainingService,
    RoutineDaysRepository,
    RoutineAccessService,
    RoutineStructureService,
    RoutineCatalogRepository,
    RoutineCatalogService,
    RoutineNotifier,
    RoutinePublicationService,
    RoutineSharesRepository,
    RoutineSharingService,
  ],
  exports: [TrainingService, TrainingRepository, RoutineAccessService],
})
export class TrainingModule {}
