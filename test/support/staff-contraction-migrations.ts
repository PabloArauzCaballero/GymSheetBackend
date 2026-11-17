import { QueryInterface, Transaction } from 'sequelize';
import { staffRolesToMembersMigration } from '../../src/database/migrations/202611201301-staff-roles-to-members';
import { retireStaffAndAccessControlMigration } from '../../src/database/migrations/202611201302-retire-staff-and-access-control';
import { retireTenantAdminChatsMigration } from '../../src/database/migrations/202611201303-retire-tenant-admin-chats';

/** Franja 7d (ADR-0029), in id order: an older migration's down/up test runs these first and last. */
const CONTRACTION = [staffRolesToMembersMigration, retireStaffAndAccessControlMigration, retireTenantAdminChatsMigration];

export async function undoStaffContraction(queryInterface: QueryInterface, transaction: Transaction): Promise<void> {
  for (const migration of [...CONTRACTION].reverse()) await migration.down(queryInterface, transaction);
}

export async function redoStaffContraction(queryInterface: QueryInterface, transaction: Transaction): Promise<void> {
  for (const migration of CONTRACTION) await migration.up(queryInterface, transaction);
}
