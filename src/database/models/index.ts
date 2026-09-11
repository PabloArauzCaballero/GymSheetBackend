import { AdminPermissionModel } from "../../modules/admin-access/admin-permission.model";
import { TenantModel } from "../../modules/tenants/tenant.model";
import { AdminUserPermissionModel } from "../../modules/admin-access/admin-user-permission.model";
import { AccessCredentialModel } from "../../modules/access-control/access-credential.model";
import { AccessDecisionModel } from "../../modules/access-control/access-decision.model";
import { AccessDeviceEventModel } from "../../modules/access-control/access-device-event.model";
import { AccessDeviceModel } from "../../modules/access-control/access-device.model";
import { PasswordResetTokenModel } from "../../modules/auth/password-reset-token.model";
import { RefreshTokenModel } from "../../modules/auth/refresh-token.model";
import { EquipmentModel } from "../../modules/equipment/equipment.model";
import { ExerciseEquipmentModel } from "../../modules/exercises/exercise-equipment.model";
import { ExerciseMediaModel } from "../../modules/exercises/exercise-media.model";
import { ExerciseModel } from "../../modules/exercises/exercise.model";
import { UserExerciseModel } from "../../modules/exercises/user-exercise.model";
import { MuscleGroupModel } from "../../modules/exercises/muscles/muscle-group.model";
import { MuscleModel } from "../../modules/exercises/muscles/muscle.model";
import { ExerciseMuscleModel } from "../../modules/exercises/muscles/exercise-muscle.model";
import { ExerciseRatingModel } from "../../modules/exercises/muscles/exercise-rating.model";
import { UserExercisePreferenceModel } from "../../modules/exercises/muscles/user-exercise-preference.model";
import { AccessPointModel } from "../../modules/facilities/access-point.model";
import { BranchModel } from "../../modules/facilities/branch.model";
import { EquipmentAssignmentModel } from "../../modules/facilities/equipment-assignment.model";
import { MaintenanceEventModel } from "../../modules/facilities/maintenance-event.model";
import { RoomModel } from "../../modules/facilities/room.model";
import { DomainEventModel } from "../../modules/integration/domain-event.model";
import { LegacyImportBatchModel } from "../../modules/integration/legacy-import-batch.model";
import { LegacyImportRecordModel } from "../../modules/integration/legacy-import-record.model";
import { OutboxJobModel } from "../../modules/integration/outbox-job.model";
import { CustomerProfileModel } from "../../modules/membership/customer-profile.model";
import { MembershipPlanModel } from "../../modules/membership/membership-plan.model";
import { MembershipStatusHistoryModel } from "../../modules/membership/membership-status-history.model";
import { MembershipModel } from "../../modules/membership/membership.model";
import { PlanAccessScopeModel } from "../../modules/membership/plan-access-scope.model";
import { StaffBranchScopeModel } from "../../modules/membership/staff-branch-scope.model";
import { StaffProfileModel } from "../../modules/membership/staff-profile.model";
import { DeliveryAttemptModel } from "../../modules/notifications/delivery-attempt.model";
import { NotificationPreferenceModel } from "../../modules/notifications/notification-preference.model";
import { NotificationModel } from "../../modules/notifications/notification.model";
import { AnthropometricProfileModel } from "../../modules/profiles/anthropometric-profile.model";
import { BodyMeasurementModel } from "../../modules/profiles/body-measurement.model";
import { OnboardingModel } from "../../modules/profiles/onboarding.model";
import { ProfilePhotoModel } from "../../modules/profiles/profile-photo.model";
import { ConnectionModel } from "../../modules/social/connection.model";
import { DiscoveryPassModel } from "../../modules/social/discovery-pass.model";
import { ProfileSocialSettingsModel } from "../../modules/social/profile-social-settings.model";
import { ConversationModel } from "../../modules/chat/conversation.model";
import { ConversationParticipantModel } from "../../modules/chat/conversation-participant.model";
import { MessageModel } from "../../modules/chat/message.model";
import { StoryModel } from "../../modules/stories/story.model";
import { StoryViewModel } from "../../modules/stories/story-view.model";
import { ProfileViewModel } from "../../modules/profile-views/profile-view.model";
import { RoutineModel } from "../../modules/training/routine.model";
import { RoutineExerciseModel } from "../../modules/training/routine-exercise.model";
import { RoutineAssignmentModel } from "../../modules/training/routine-assignment.model";
import { EntitlementModel } from "../../modules/membership/entitlement.model";
import { MediaFileModel } from "../../modules/membership/media-file.model";
import { MembershipExtensionModel } from "../../modules/membership/membership-extension.model";
import { MembershipFeatureModel } from "../../modules/membership/membership-feature.model";
import { MembershipIntentModel } from "../../modules/membership/membership-intent.model";
import { PlanFeatureModel } from "../../modules/membership/plan-feature.model";
import { MembershipActivationRequestModel } from "../../modules/membership/membership-activation-request.model";
import { ProgressionLevelModel } from "../../modules/progression/progression-level.model";
import { ProgressionBadgeModel } from "../../modules/progression/progression-badge.model";
import { UserBadgeModel } from "../../modules/progression/user-badge.model";
import { UserProgressModel } from "../../modules/progression/user-progress.model";
import { RestDayPreferenceModel } from "../../modules/progression/rest-day-preference.model";
import { UserModel } from "../../modules/users/user.model";
import { WorkoutSessionExerciseModel } from "../../modules/workouts/workout-session-exercise.model";
import { WorkoutSessionModel } from "../../modules/workouts/workout-session.model";
import { WorkoutSetModel } from "../../modules/workouts/workout-set.model";

export const databaseModels = [
  UserModel,
  RefreshTokenModel,
  PasswordResetTokenModel,
  MembershipActivationRequestModel,
  AnthropometricProfileModel,
  OnboardingModel,
  BodyMeasurementModel,
  ProfilePhotoModel,
  ConnectionModel,
  ProfileSocialSettingsModel,
  DiscoveryPassModel,
  ConversationModel,
  ConversationParticipantModel,
  MessageModel,
  StoryModel,
  StoryViewModel,
  ProfileViewModel,
  EquipmentModel,
  ExerciseModel,
  ExerciseEquipmentModel,
  ExerciseMediaModel,
  UserExerciseModel,
  MuscleGroupModel,
  MuscleModel,
  ExerciseMuscleModel,
  ExerciseRatingModel,
  UserExercisePreferenceModel,
  WorkoutSessionModel,
  WorkoutSessionExerciseModel,
  WorkoutSetModel,
  RoutineModel,
  RoutineExerciseModel,
  RoutineAssignmentModel,
  BranchModel,
  RoomModel,
  AccessPointModel,
  EquipmentAssignmentModel,
  MaintenanceEventModel,
  MembershipPlanModel,
  MediaFileModel,
  MembershipFeatureModel,
  PlanFeatureModel,
  EntitlementModel,
  MembershipIntentModel,
  MembershipExtensionModel,
  PlanAccessScopeModel,
  MembershipModel,
  MembershipStatusHistoryModel,
  CustomerProfileModel,
  StaffProfileModel,
  StaffBranchScopeModel,
  AccessCredentialModel,
  AccessDeviceModel,
  AccessDeviceEventModel,
  AccessDecisionModel,
  NotificationModel,
  NotificationPreferenceModel,
  DeliveryAttemptModel,
  DomainEventModel,
  OutboxJobModel,
  LegacyImportBatchModel,
  LegacyImportRecordModel,
  ProgressionLevelModel,
  ProgressionBadgeModel,
  UserBadgeModel,
  UserProgressModel,
  RestDayPreferenceModel,
  AdminPermissionModel,
  AdminUserPermissionModel,
  TenantModel,
];
