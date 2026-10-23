import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ExerciseModel } from '../exercises/exercise.model';
import { ExercisesModule } from '../exercises/exercises.module';
import { UserModel } from '../users/user.model';
import { WorkoutsModule } from '../workouts/workouts.module';
import { OnboardingModel } from '../profiles/onboarding.model';
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
import { RoutineAdminController } from './routine-admin.controller';
import { RoutineAdminService } from './routine-admin.service';
import { ProductEvents } from '../../common/tracking/product-events';
import { RoutineAccessService } from './routine-access.service';
import { RoutineDaysRepository } from './routine-days.repository';
import { RoutineCatalogRepository } from './routine-catalog.repository';
import { RoutineCatalogService } from './routine-catalog.service';
import { RoutineStructureService } from './routine-structure.service';
import { SessionRestController } from './session-rest.controller';
import { SessionRestService } from './session-rest.service';
import { SessionSwapController } from './session-swap.controller';
import { SessionSwapService } from './session-swap.service';
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
      OnboardingModel,
    ]),
    ExercisesModule,
    WorkoutsModule,
    NotificationsModule,
  ],
  controllers: [
    TrainingController,
    RoutinePublicationController,
    RoutineSharingController,
    RoutineAdminController,
    SessionRestController,
    SessionSwapController,
  ],
  providers: [
    TrainingRepository,
    TrainingService,
    RoutineDaysRepository,
    RoutineAccessService,
    RoutineStructureService,
    RoutineCatalogRepository,
    RoutineCatalogService,
    RoutineAdminService,
    ProductEvents,
    RoutineNotifier,
    RoutinePublicationService,
    RoutineSharesRepository,
    RoutineSharingService,
    SessionRestService,
    SessionSwapService,
  ],
  exports: [
    TrainingService,
    TrainingRepository,
    RoutineAccessService,
    RoutineNotifier,
    RoutinePublicationService,
    RoutineStructureService,
    RoutineDaysRepository,
    ProductEvents,
  ],
})
export class TrainingModule {}
