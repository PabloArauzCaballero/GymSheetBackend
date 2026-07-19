import { AccessCredentialModel } from '../../modules/access-control/access-credential.model';
import { AccessDecisionModel } from '../../modules/access-control/access-decision.model';
import { AccessDeviceEventModel } from '../../modules/access-control/access-device-event.model';
import { AccessDeviceModel } from '../../modules/access-control/access-device.model';
import { EquipmentModel } from '../../modules/equipment/equipment.model';
import { ExerciseEquipmentModel } from '../../modules/exercises/exercise-equipment.model';
import { ExerciseMediaModel } from '../../modules/exercises/exercise-media.model';
import { ExerciseModel } from '../../modules/exercises/exercise.model';
import { UserExerciseModel } from '../../modules/exercises/user-exercise.model';
import { AccessPointModel } from '../../modules/facilities/access-point.model';
import { BranchModel } from '../../modules/facilities/branch.model';
import { EquipmentAssignmentModel } from '../../modules/facilities/equipment-assignment.model';
import { RoomModel } from '../../modules/facilities/room.model';
import { LegacyImportBatchModel } from '../../modules/integration/legacy-import-batch.model';
import { LegacyImportRecordModel } from '../../modules/integration/legacy-import-record.model';
import { OutboxJobModel } from '../../modules/integration/outbox-job.model';
import { MembershipPlanModel } from '../../modules/membership/membership-plan.model';
import { MembershipModel } from '../../modules/membership/membership.model';
import { PlanAccessScopeModel } from '../../modules/membership/plan-access-scope.model';
import { StaffBranchScopeModel } from '../../modules/membership/staff-branch-scope.model';
import { StaffProfileModel } from '../../modules/membership/staff-profile.model';
import { DeliveryAttemptModel } from '../../modules/notifications/delivery-attempt.model';
import { NotificationModel } from '../../modules/notifications/notification.model';
import { AnthropometricProfileModel } from '../../modules/profiles/anthropometric-profile.model';
import { UserModel } from '../../modules/users/user.model';
import { WorkoutSessionExerciseModel } from '../../modules/workouts/workout-session-exercise.model';
import { WorkoutSessionModel } from '../../modules/workouts/workout-session.model';
import { WorkoutSetModel } from '../../modules/workouts/workout-set.model';

/** Explicit model registry prevents accidental runtime discovery. */
export const databaseModels = [
  UserModel,
  AnthropometricProfileModel,
  EquipmentModel,
  ExerciseModel,
  ExerciseEquipmentModel,
  ExerciseMediaModel,
  UserExerciseModel,
  WorkoutSessionModel,
  WorkoutSessionExerciseModel,
  WorkoutSetModel,
  BranchModel,
  RoomModel,
  AccessPointModel,
  EquipmentAssignmentModel,
  MembershipPlanModel,
  PlanAccessScopeModel,
  MembershipModel,
  StaffProfileModel,
  StaffBranchScopeModel,
  AccessCredentialModel,
  AccessDeviceModel,
  AccessDeviceEventModel,
  AccessDecisionModel,
  NotificationModel,
  DeliveryAttemptModel,
  OutboxJobModel,
  LegacyImportBatchModel,
  LegacyImportRecordModel,
];
