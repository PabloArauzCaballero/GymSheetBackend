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
import { passwordResetAndEmailChannelMigration } from "./202608190001-password-reset-and-email-channel";
import { userTenantMigration } from "./202608190002-user-tenant";
import { equipmentUsageAndCashActivationMigration } from "./202608190003-equipment-usage-and-cash-activation";
import { dropRedundantExerciseEquipmentMigration } from "./202608190004-drop-redundant-exercise-equipment";
import { uniqueGlobalExerciseNameMigration } from "./202608200001-unique-global-exercise-name";
import { scopeUniqueExerciseNameToCustomMigration } from "./202608200002-scope-unique-exercise-name-to-custom";
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
  passwordResetAndEmailChannelMigration,
  userTenantMigration,
  equipmentUsageAndCashActivationMigration,
  dropRedundantExerciseEquipmentMigration,
  uniqueGlobalExerciseNameMigration,
  scopeUniqueExerciseNameToCustomMigration,
];
