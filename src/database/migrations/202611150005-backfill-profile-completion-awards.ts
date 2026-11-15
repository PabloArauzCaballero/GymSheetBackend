import { DatabaseMigration } from "./migration.types";
import { grandfatherExistingProfileItems } from "./profile-completion-backfill.snapshot";

/**
 * No retroactive points (product decision, `docs/progression/la-senda.md` §5.1):
 * every profile item an account already satisfies is recorded at 0 points, so it
 * shows as done and is never offered again; only items completed afterwards pay.
 *
 * Separate from `202611150001` on purpose: the runner wraps each migration in one
 * transaction, and there `ADD COLUMN bio` holds ACCESS EXCLUSIVE on `usuarios`
 * until commit. Here the walk only reads `usuarios` and inserts into the ledger
 * (row-level FK locks), so logins and auth revalidation keep flowing.
 *
 * The predicates are a frozen snapshot (`profile-completion-backfill.snapshot.ts`),
 * not the live service code, so this migration keeps its meaning forever.
 */
export const backfillProfileCompletionAwardsMigration: DatabaseMigration = {
  id: "202611150005-backfill-profile-completion-awards",
  description: "Records the profile items existing accounts already had at 0 points (no retroactive points).",
  up: async (queryInterface, transaction) => {
    await grandfatherExistingProfileItems(queryInterface.sequelize, transaction);
  },
  // The ledger is append-only (.claude/rules/80-database.md): rolling this back
  // keeps the rows. Re-running `up` is idempotent, and rolling back
  // 202611150001 drops the whole table.
  down: () => Promise.resolve(),
};
