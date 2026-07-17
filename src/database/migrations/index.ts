import { hardeningExerciseDataMigration } from './202607170001-hardening-exercise-data';
import { DatabaseMigration } from './migration.types';

/** Ordered migration registry. IDs must remain immutable after deployment. */
export const databaseMigrations: readonly DatabaseMigration[] = [
  hardeningExerciseDataMigration,
];
