import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * The product is now called REPP. Migration `202608290001-tenants-and-system-admin`
 * inserted the reference gym as 'GymSheet' and must not be edited once applied,
 * so this one renames it on every database (existing and new). The guard on the
 * old name keeps any name an administrator already chose untouched.
 */
const upStatements = [
  `UPDATE public.tenants
      SET nombre = 'REPP', updated_at = now()
    WHERE id = 'default' AND nombre = 'GymSheet'`,
] as const;

const downStatements = [
  `UPDATE public.tenants
      SET nombre = 'GymSheet', updated_at = now()
    WHERE id = 'default' AND nombre = 'REPP'`,
] as const;

export const renameDefaultTenantReppMigration: DatabaseMigration = {
  id: "202611150002-rename-default-tenant-repp",
  description: "Renames the default tenant from GymSheet to REPP unless an admin already renamed it.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
