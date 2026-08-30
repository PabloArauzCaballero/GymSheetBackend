import { Transaction } from 'sequelize';
import { ADMIN_PERMISSION_CATALOG } from '../../modules/admin-access/admin-permission.catalog';
import { AdminPermissionModel } from '../../modules/admin-access/admin-permission.model';
import { AdminUserPermissionModel } from '../../modules/admin-access/admin-user-permission.model';
import { UserModel } from '../../modules/users/user.model';

export type AdminPermissionsSeedResult = {
  permissionsCreated: number;
  permissionsUpdated: number;
  permissionsUnchanged: number;
  grantsCreated: number;
};

async function upsertPermission(
  definition: (typeof ADMIN_PERMISSION_CATALOG)[number],
  transaction: Transaction,
): Promise<'created' | 'updated' | 'unchanged'> {
  const existing = await AdminPermissionModel.findByPk(definition.key, { transaction });
  if (existing) {
    const unchanged =
      existing.label === definition.label &&
      existing.description === definition.description &&
      existing.domain === definition.domain;
    if (unchanged) return 'unchanged';
    await existing.update(
      { label: definition.label, description: definition.description, domain: definition.domain },
      { transaction },
    );
    return 'updated';
  }
  await AdminPermissionModel.create(
    {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      domain: definition.domain,
    },
    { transaction },
  );
  return 'created';
}

/**
 * Seeds the static permission catalog (all modes) and grants the full
 * permission set to the bootstrap admin account, so it never locks itself
 * out of the granular admin surfaces this catalog gates.
 */
export async function seedAdminPermissions(
  transaction: Transaction,
  bootstrapAdminEmail?: string,
): Promise<AdminPermissionsSeedResult> {
  const counters = { permissionsCreated: 0, permissionsUpdated: 0, permissionsUnchanged: 0 };
  for (const definition of ADMIN_PERMISSION_CATALOG) {
    const outcome = await upsertPermission(definition, transaction);
    if (outcome === 'created') counters.permissionsCreated += 1;
    else if (outcome === 'updated') counters.permissionsUpdated += 1;
    else counters.permissionsUnchanged += 1;
  }

  let grantsCreated = 0;
  if (bootstrapAdminEmail) {
    const admin = await UserModel.findOne({
      where: { email: bootstrapAdminEmail.toLowerCase() },
      transaction,
    });
    if (admin) {
      for (const definition of ADMIN_PERMISSION_CATALOG) {
        const existingGrant = await AdminUserPermissionModel.findOne({
          where: { userId: admin.id, permissionKey: definition.key },
          transaction,
        });
        if (!existingGrant) {
          await AdminUserPermissionModel.create(
            {
              userId: admin.id,
              permissionKey: definition.key,
              grantedByUserId: admin.id,
              grantedAt: new Date(),
              expiresAt: null,
            },
            { transaction },
          );
          grantsCreated += 1;
        }
      }
    }
  }

  return { ...counters, grantsCreated };
}
