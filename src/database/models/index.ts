import { AdminPermissionModel } from "../../modules/admin-access/admin-permission.model";
import { TenantModel } from "../../modules/tenants/tenant.model";
import { AdminUserPermissionModel } from "../../modules/admin-access/admin-user-permission.model";
import { AdminAuditLogModel } from "../../modules/admin-access/audit-log.model";
import { ModerationReportModel } from "../../modules/moderation/report.model";
import { UserStrikeModel } from "../../modules/moderation/user-strike.model";
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
import { DeviceTokenModel } from "../../modules/notifications/device-token.model";
import { AnthropometricProfileModel } from "../../modules/profiles/anthropometric-profile.model";
import { BodyMeasurementModel } from "../../modules/profiles/body-measurement.model";
import { OnboardingModel } from "../../modules/profiles/onboarding.model";
import { ProfilePhotoModel } from "../../modules/profiles/profile-photo.model";
import { ConnectionModel } from "../../modules/social/connection.model";
import { DiscoveryPassModel } from "../../modules/social/discovery-pass.model";
import { ProfileSocialSettingsModel } from "../../modules/social/profile-social-settings.model";
import { SocialMapLocationModel } from "../../modules/social/social-map-location.model";
import { SocialMapPlaceModel } from "../../modules/social/social-map-place.model";
import { ConversationModel } from "../../modules/chat/conversation.model";
import { ConversationParticipantModel } from "../../modules/chat/conversation-participant.model";
import { ConversationEventModel } from "../../modules/chat/conversation-event.model";
import { MessageVisibilityModel } from "../../modules/chat/message-visibility.model";
import { MessageReactionModel } from "../../modules/chat/message-reaction.model";
import { MessageModel } from "../../modules/chat/message.model";
import { StoryModel } from "../../modules/stories/story.model";
import { StoryAudienceModel } from "../../modules/stories/story-audience.model";
import { StoryViewModel } from "../../modules/stories/story-view.model";
import { ReelModel } from "../../modules/reels/reel.model";
import { MusicPlaylistModel } from "../../modules/music/music-playlist.model";
import { TrainingInviteModel } from "../../modules/training-invitations/training-invite.model";
import { TrainingInviteRevisionModel } from "../../modules/training-invitations/training-invite-revision.model";
import { TrainingMeetingModel } from "../../modules/training-invitations/training-meeting.model";
import { ProfileViewModel } from "../../modules/profile-views/profile-view.model";
import { RoutineModel } from "../../modules/training/routine.model";
import { RoutineExerciseModel } from "../../modules/training/routine-exercise.model";
import { RoutineAssignmentModel } from "../../modules/training/routine-assignment.model";
import { RoutineDayModel } from "../../modules/training/routine-day.model";
import { RoutineWeekOverrideModel } from "../../modules/training/routine-week-override.model";
import { RoutineShareModel } from "../../modules/training/routine-share.model";
import { RoutineProgressDownloadAuditModel } from "../../modules/export/routine-progress-download-audit.model";
import {
  ProgramLiftTargetModel,
  ProgramWeekModel,
  TrainingProgramModel,
} from "../../modules/programs/program.models";
import { CardioPlanModel } from "../../modules/programs/cardio-plan.model";
import { ContentRatingModel } from "../../modules/community/content-rating.model";
import { ContentCommentModel } from "../../modules/community/content-comment.model";
import { ExerciseLikeModel } from "../../modules/community/exercise-like.model";
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
import { UserStreakStrikeModel } from "../../modules/progression/user-streak-strike.model";
import { UserModel } from "../../modules/users/user.model";
import { WorkoutSessionExerciseModel } from "../../modules/workouts/workout-session-exercise.model";
import { WorkoutSessionModel } from "../../modules/workouts/workout-session.model";
import { WorkoutSetModel } from "../../modules/workouts/workout-set.model";
import { CategoryModel } from "../../modules/directory/category.model";
import { DirectoryEntityModel } from "../../modules/directory/directory-entity.model";
import { DirectoryEntityCategoryModel } from "../../modules/directory/directory-entity-category.model";
import { DirectoryReviewModel } from "../../modules/directory/directory-review.model";
import { DirectoryReviewReplyModel } from "../../modules/directory/directory-review-reply.model";
import { DirectoryReviewHelpfulModel } from "../../modules/directory/directory-review-helpful.model";
import { EntityPaymentConfigModel } from "../../modules/directory/models/entity-payment-config.model";
import { EntityPlanModel } from "../../modules/directory/models/entity-plan.model";
import { PlanPriceHistoryModel } from "../../modules/directory/models/plan-price-history.model";
import { PaymentOrderModel } from "../../modules/directory/models/payment-order.model";
import { WorkoutSkippedSetModel } from "../../modules/workouts/workout-skipped-set.model";
import { WorkoutExerciseSwapModel } from "../../modules/workouts/workout-exercise-swap.model";

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
  SocialMapLocationModel,
  SocialMapPlaceModel,
  ConversationModel,
  ConversationParticipantModel,
  MessageModel,
  MessageVisibilityModel,
  MessageReactionModel,
  ConversationEventModel,
  StoryModel,
  StoryAudienceModel,
  StoryViewModel,
  ReelModel,
  MusicPlaylistModel,
  TrainingInviteModel,
  TrainingInviteRevisionModel,
  TrainingMeetingModel,
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
  WorkoutSkippedSetModel,
  WorkoutExerciseSwapModel,
  RoutineModel,
  RoutineExerciseModel,
  RoutineAssignmentModel,
  RoutineDayModel,
  RoutineWeekOverrideModel,
  RoutineShareModel,
  RoutineProgressDownloadAuditModel,
  ContentRatingModel,
  TrainingProgramModel,
  CardioPlanModel,
  ProgramLiftTargetModel,
  ProgramWeekModel,
  ContentCommentModel,
  ExerciseLikeModel,
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
  DeviceTokenModel,
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
  UserStreakStrikeModel,
  AdminPermissionModel,
  AdminUserPermissionModel,
  AdminAuditLogModel,
  ModerationReportModel,
  UserStrikeModel,
  TenantModel,
  CategoryModel,
  DirectoryEntityModel,
  DirectoryEntityCategoryModel,
  DirectoryReviewModel,
  DirectoryReviewReplyModel,
  DirectoryReviewHelpfulModel,
  EntityPaymentConfigModel,
  EntityPlanModel,
  PlanPriceHistoryModel,
  PaymentOrderModel,
];
