import { hardeningExerciseDataMigration } from "./202607170001-hardening-exercise-data";
import { facilitiesMembershipMigration } from "./202607190001-facilities-membership";
import { accessNotificationsOutboxMigration } from "./202607190002-access-notifications-outbox";
import { legacyImportStagingMigration } from "./202607190003-legacy-import-staging";
import { equipmentPlanCustomerDetailsMigration } from "./202607190004-equipment-plan-customer-details";
import { notificationPreferencesMigration } from "./202607190005-notification-preferences";
import { domainEventsAndMembershipHistoryMigration } from "./202607190006-domain-events-and-membership-history";
import { exerciseDatasetSyncStateMigration } from "./202607220001-exercise-dataset-sync-state";
import { customerExperienceMigration } from "./202607220002-customer-experience";
import { trainingPlansRoutinesMigration } from "./202608010001-training-plans-routines";
import { localExerciseMediaUrlMigration } from "./202608130001-local-exercise-media-url";
import { exerciseMusclesAndRatingsMigration } from "./202608130002-exercise-muscles-and-ratings";
import { routineRecurrenceWindowMigration } from "./202608170001-routine-recurrence-window";
import { userTenantMigration } from "./202608180001-user-tenant";
import { progressionMigration } from "./202608230001-progression";
import { userGenderMigration } from "./202608230002-user-gender";
import { authTokensMigration } from "./202608230003-auth-tokens";
import { userTermsConsentMigration } from "./202608250001-user-terms-consent";
import { progressionRestDaysMigration } from "./202608250002-progression-rest-days";
import { streakGeoVerificationMigration } from "./202608250003-streak-geo-verification";
import { userWeightIncrementMigration } from "./202608250004-user-weight-increment";
import { streakRewardFeaturesMigration } from "./202608250005-streak-reward-features";
import { profilePhotosMigration } from "./202608250006-profile-photos";
import { socialConnectionsMigration } from "./202608250007-social-connections";
import { chatMigration } from "./202608250008-chat";
import { userBranchMigration } from "./202608270001-user-branch";
import { userLastSeenMigration } from "./202608270002-user-last-seen";
import { branchCoverImageMigration } from "./202608270003-branch-cover-image";
import { branchAmenitiesGalleryMigration } from "./202608270004-branch-amenities-gallery";
import { branchBrandNameMigration } from "./202608270005-branch-brand-name";
import { chatSystemConversationsMigration } from "./202608270006-chat-system-conversations";
import { chatParticipantNicknameMigration } from "./202608270007-chat-participant-nickname";
import { chatReceiptsMigration } from "./202608270008-chat-receipts";
import { chatMessageMediaMigration } from "./202608270009-chat-message-media";
import { profileStoriesMigration } from "./202608280001-profile-stories";
import { profileViewsMigration } from "./202608280002-profile-views";
import { tenantsAndSystemAdminMigration } from "./202608290001-tenants-and-system-admin";
import { usuariosTenantNotNullMigration } from "./202608300001-usuarios-tenant-not-null";
import { facilitiesEquipmentMediaTenantMigration } from "./202608300002-facilities-equipment-media-tenant";
import { adminPermissionsMigration } from "./202609010001-admin-permissions";
import { socialDiscoveryPassesMigration } from "./202609020001-social-discovery-passes";
import { mediaStorageKeyIndexesMigration } from "./202609080001-media-storage-key-indexes";
import { DatabaseMigration } from "./migration.types";

/** Ordered migration registry. IDs must remain immutable after deployment. */
export const databaseMigrations: readonly DatabaseMigration[] = [
  hardeningExerciseDataMigration,
  facilitiesMembershipMigration,
  accessNotificationsOutboxMigration,
  legacyImportStagingMigration,
  equipmentPlanCustomerDetailsMigration,
  notificationPreferencesMigration,
  domainEventsAndMembershipHistoryMigration,
  exerciseDatasetSyncStateMigration,
  customerExperienceMigration,
  trainingPlansRoutinesMigration,
  localExerciseMediaUrlMigration,
  exerciseMusclesAndRatingsMigration,
  routineRecurrenceWindowMigration,
  userTenantMigration,
  progressionMigration,
  userGenderMigration,
  authTokensMigration,
  userTermsConsentMigration,
  progressionRestDaysMigration,
  streakGeoVerificationMigration,
  userWeightIncrementMigration,
  streakRewardFeaturesMigration,
  profilePhotosMigration,
  socialConnectionsMigration,
  chatMigration,
  userBranchMigration,
  userLastSeenMigration,
  branchCoverImageMigration,
  branchAmenitiesGalleryMigration,
  branchBrandNameMigration,
  chatSystemConversationsMigration,
  chatParticipantNicknameMigration,
  chatReceiptsMigration,
  chatMessageMediaMigration,
  profileStoriesMigration,
  profileViewsMigration,
  adminPermissionsMigration,
  tenantsAndSystemAdminMigration,
  usuariosTenantNotNullMigration,
  facilitiesEquipmentMediaTenantMigration,
  socialDiscoveryPassesMigration,
  mediaStorageKeyIndexesMigration,
];
