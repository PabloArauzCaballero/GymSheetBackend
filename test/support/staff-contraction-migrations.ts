import { QueryInterface, Transaction } from 'sequelize';
import { businessClosureMigration } from '../../src/database/migrations/202611201201-business-closure';
import { contractPaymentReceiptUrlMigration } from '../../src/database/migrations/202611201202-contract-payment-receipt-url';
import { staffRolesToMembersMigration } from '../../src/database/migrations/202611201301-staff-roles-to-members';
import { retireStaffAndAccessControlMigration } from '../../src/database/migrations/202611201302-retire-staff-and-access-control';
import { retireTenantAdminChatsMigration } from '../../src/database/migrations/202611201303-retire-tenant-admin-chats';

/**
 * The migrations newer than 8e, in id order: the business closure of franja 8f (ADR-0028) and the staff
 * contraction of franja 7d (ADR-0029). An older migration's down/up test runs these first and last.
 */
const CONTRACTION = [
  businessClosureMigration,
  contractPaymentReceiptUrlMigration,
  staffRolesToMembersMigration,
  retireStaffAndAccessControlMigration,
  retireTenantAdminChatsMigration,
];

export async function undoStaffContraction(queryInterface: QueryInterface, transaction: Transaction): Promise<void> {
  for (const migration of [...CONTRACTION].reverse()) await migration.down(queryInterface, transaction);
}

export async function redoStaffContraction(queryInterface: QueryInterface, transaction: Transaction): Promise<void> {
  for (const migration of CONTRACTION) await migration.up(queryInterface, transaction);
}
