import { hardeningExerciseDataMigration } from './202607170001-hardening-exercise-data';
import { facilitiesMembershipMigration } from './202607190001-facilities-membership';
import { accessNotificationsOutboxMigration } from './202607190002-access-notifications-outbox';
import { legacyImportStagingMigration } from './202607190003-legacy-import-staging';
import { equipmentPlanCustomerDetailsMigration } from './202607190004-equipment-plan-customer-details';
import { notificationPreferencesMigration } from './202607190005-notification-preferences';
import { DatabaseMigration } from './migration.types';

/** Ordered migration registry. IDs must remain immutable after deployment. */
export const databaseMigrations: readonly DatabaseMigration[] = [
  hardeningExerciseDataMigration,
  facilitiesMembershipMigration,
  accessNotificationsOutboxMigration,
  legacyImportStagingMigration,
  equipmentPlanCustomerDetailsMigration,
  notificationPreferencesMigration,
];
