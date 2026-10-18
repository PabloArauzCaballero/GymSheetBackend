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
import { userTenantMigration as userTenantInitialMigration } from "./202608180001-user-tenant";
import { passwordResetAndEmailChannelMigration } from "./202608190001-password-reset-and-email-channel";
import { userTenantMigration as userTenantFollowupMigration } from "./202608190002-user-tenant";
import { equipmentUsageAndCashActivationMigration } from "./202608190003-equipment-usage-and-cash-activation";
import { dropRedundantExerciseEquipmentMigration } from "./202608190004-drop-redundant-exercise-equipment";
import { uniqueGlobalExerciseNameMigration } from "./202608200001-unique-global-exercise-name";
import { scopeUniqueExerciseNameToCustomMigration } from "./202608200002-scope-unique-exercise-name-to-custom";
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
import { socialInteractionsMigration } from "./202609110001-social-interactions";
import { dropOrphanAuthPasswordResetTokensMigration } from "./202609110002-drop-orphan-auth-password-reset-tokens";
import { deviceTokensMigration } from "./202609131200-device-tokens";
import { adminAuditLogMigration } from "./202609150001-admin-audit-log";
import { moderationMigration } from "./202609150002-moderation";
import { webPushDeviceTokensMigration } from "./202609160001-web-push-device-tokens";
import { profileBirthDateMigration } from "./202609160002-profile-birth-date";
import { exerciseMediaPlainHttpMigration } from "./202609160003-exercise-media-plain-http";
import { routineWorkoutFlowMigration } from "./202610060001-routine-workout-flow";
import { chatReadReceiptPreferencesMigration } from "./202610080001-chat-read-receipt-preferences";
import { routinesV2StructureMigration } from "./202610080001-routines-v2-structure";
import { routineSharingMigration } from "./202610080002-routine-sharing";
import { communityMigration } from "./202610080003-community";
import { moderationRoutineKindsMigration } from "./202610080004-moderation-routine-kinds";
import { programsMigration } from "./202610080005-programs";
import { cardioAndRewardsMigration } from "./202610080006-cardio-and-rewards";
import { socialProfileDiscoveryConsentMigration } from "./202610090001-social-profile-discovery-consent";
import { chatRevocationMigration } from "./202610090002-chat-revocation";
import { socialMapLocationsMigration } from "./202610090003-social-map-locations";
import { socialMapPlacesMigration } from "./202610090004-social-map-places";
import { socialMapPlaceBranchLinksMigration } from "./202610090005-social-map-place-branch-links";
import { socialBlocksMigration } from "./202610090006-social-blocks";
import { socialDiscoveryPreferencesMigration } from "./202610090007-social-discovery-preferences";
import { socialRecommendationVersionsMigration } from "./202610090008-social-recommendation-versions";
import { chatMessageIdempotencyMigration } from "./202610090009-chat-message-idempotency";
import { chatAudioMessageMigration } from "./202610090010-chat-audio-message";
import { chatStickerMessageMigration } from "./202610090011-chat-sticker-message";
import { chatMessageEditMigration } from "./202610090012-chat-message-edit";
import { chatMessageIdempotencyBodyMigration } from "./202610090013-chat-message-idempotency-body";
import { chatMessageLocalVisibilityMigration } from "./202610090014-chat-message-local-visibility";
import { chatMessageGlobalDeleteMigration } from "./202610090015-chat-message-global-delete";
import { routineGroupsCopiesSessionTargetsMigration } from "./202610100001-routine-groups-copies-session-targets";
import { storiesSelectedAudienceMigration } from "./202610100001-stories-selected-audience";
import { chatMessageStoryReferenceMigration } from "./202610100002-chat-message-story-reference";
import { chatStoryRequestFingerprintMigration } from "./202610100003-chat-story-request-fingerprint";
import { storyUploadIdempotencyMigration } from "./202610100004-story-upload-idempotency";
import { reelsMigration } from "./202610100005-reels";
import { reelUploadIdempotencyMigration } from "./202610110001-reel-upload-idempotency";
import { timedStrengthSetsMigration } from "./202610110001-timed-strength-sets";
import { trainingInvitationsMigration } from "./202610110002-training-invitations";
import { trainingInviteResponsesMigration } from "./202610110003-training-invite-responses";
import { trainingInviteCounterproposalsMigration } from "./202610110004-training-invite-counterproposals";
import { trainingInviteMeetingsChatEventsMigration } from "./202610110005-training-invite-meetings-chat-events";
import { trainingInviteExpirationMigration } from "./202610110006-training-invite-expiration";
import { trainingInviteDisconnectCancellationMigration } from "./202610110007-training-invite-disconnect-cancellation";
import { trainingInviteSharedSnapshotMigration } from "./202610110008-training-invite-shared-snapshot";
import { commentLikesMigration } from "./202610120001-comment-likes";
import { trainingInviteDeclineMigration } from "./202610120001-training-invite-decline";
import { reelSocialInteractionsMigration } from "./202610130001-reel-social-interactions";
import { sessionSkipsMigration } from "./202610130001-session-skips";
import { exerciseSearchMigration } from "./202610130002-exercise-search";
import { reelModerationMigration } from "./202610130002-reel-moderation";
import { badgesSocialCardioMigration } from "./202610130003-badges-social-cardio";
import { notificationSuppressionMigration } from "./202610130003-notification-suppression";
import { privateMessagePreviewsMigration } from "./202610130004-private-message-previews";
import { socialDiscoveryImpressionsMigration } from "./202610130005-social-discovery-impressions";
import { commentMediaMigration } from "./202610140001-comment-media";
import { chatEventCancellationMigration } from "./202610150001-chat-event-cancellation";
import { musicPlaylistsMigration } from "./202610150002-music-playlists";
import { premiosRetosEscudosMigration } from "./202610180001-premios-retos-escudos";
import { chatLocationLabelMigration } from "./202610180101-chat-location-label";
import { chatDisappearingMessagesMigration } from "./202610180102-chat-disappearing-messages";
import { chatRepliesReactionsForwardMigration } from "./202610180201-chat-replies-reactions-forward";
import { DatabaseMigration } from "./migration.types";

/** Ordered migration registry. IDs must remain immutable after deployment. */
export const databaseMigrations: DatabaseMigration[] = [
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
  userTenantInitialMigration,
  passwordResetAndEmailChannelMigration,
  userTenantFollowupMigration,
  equipmentUsageAndCashActivationMigration,
  dropRedundantExerciseEquipmentMigration,
  uniqueGlobalExerciseNameMigration,
  scopeUniqueExerciseNameToCustomMigration,
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
  tenantsAndSystemAdminMigration,
  usuariosTenantNotNullMigration,
  facilitiesEquipmentMediaTenantMigration,
  adminPermissionsMigration,
  socialDiscoveryPassesMigration,
  mediaStorageKeyIndexesMigration,
  socialInteractionsMigration,
  dropOrphanAuthPasswordResetTokensMigration,
  deviceTokensMigration,
  adminAuditLogMigration,
  moderationMigration,
  webPushDeviceTokensMigration,
  profileBirthDateMigration,
  exerciseMediaPlainHttpMigration,
  routineWorkoutFlowMigration,
  chatReadReceiptPreferencesMigration,
  routinesV2StructureMigration,
  routineSharingMigration,
  communityMigration,
  moderationRoutineKindsMigration,
  programsMigration,
  cardioAndRewardsMigration,
  socialProfileDiscoveryConsentMigration,
  chatRevocationMigration,
  socialMapLocationsMigration,
  socialMapPlacesMigration,
  socialMapPlaceBranchLinksMigration,
  socialBlocksMigration,
  socialDiscoveryPreferencesMigration,
  socialRecommendationVersionsMigration,
  chatMessageIdempotencyMigration,
  chatAudioMessageMigration,
  chatStickerMessageMigration,
  chatMessageEditMigration,
  chatMessageIdempotencyBodyMigration,
  chatMessageLocalVisibilityMigration,
  chatMessageGlobalDeleteMigration,
  routineGroupsCopiesSessionTargetsMigration,
  storiesSelectedAudienceMigration,
  chatMessageStoryReferenceMigration,
  chatStoryRequestFingerprintMigration,
  storyUploadIdempotencyMigration,
  reelsMigration,
  reelUploadIdempotencyMigration,
  timedStrengthSetsMigration,
  trainingInvitationsMigration,
  trainingInviteResponsesMigration,
  trainingInviteCounterproposalsMigration,
  trainingInviteMeetingsChatEventsMigration,
  trainingInviteExpirationMigration,
  trainingInviteDisconnectCancellationMigration,
  trainingInviteSharedSnapshotMigration,
  commentLikesMigration,
  trainingInviteDeclineMigration,
  reelSocialInteractionsMigration,
  sessionSkipsMigration,
  exerciseSearchMigration,
  reelModerationMigration,
  badgesSocialCardioMigration,
  notificationSuppressionMigration,
  privateMessagePreviewsMigration,
  socialDiscoveryImpressionsMigration,
  commentMediaMigration,
  chatEventCancellationMigration,
  musicPlaylistsMigration,
  premiosRetosEscudosMigration,
  chatLocationLabelMigration,
  chatDisappearingMessagesMigration,
  chatRepliesReactionsForwardMigration,
];
