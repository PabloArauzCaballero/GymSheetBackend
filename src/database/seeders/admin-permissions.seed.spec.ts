import type { Transaction } from "sequelize";
import { ADMIN_PERMISSION_CATALOG } from "../../modules/admin-access/admin-permission.catalog";

const permissionUpdate = jest.fn();
const grantCreate = jest.fn();

jest.mock("../../modules/admin-access/admin-permission.model", () => ({
  AdminPermissionModel: {
    findByPk: jest.fn(),
    create: jest.fn(),
  },
}));
jest.mock("../../modules/admin-access/admin-user-permission.model", () => ({
  AdminUserPermissionModel: {
    findOne: jest.fn(),
    create: grantCreate,
  },
}));
jest.mock("../../modules/users/user.model", () => ({
  UserModel: { findOne: jest.fn() },
}));

import { seedAdminPermissions } from "./admin-permissions.seed";
import { AdminPermissionModel } from "../../modules/admin-access/admin-permission.model";
import { AdminUserPermissionModel } from "../../modules/admin-access/admin-user-permission.model";
import { UserModel } from "../../modules/users/user.model";

const transaction = {} as Transaction;
const catalogSize = ADMIN_PERMISSION_CATALOG.length;

describe("seedAdminPermissions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates every catalog permission when none exist yet, without touching grants if no admin email is given", async () => {
    (AdminPermissionModel.findByPk as jest.Mock).mockResolvedValue(null);

    const result = await seedAdminPermissions(transaction);

    expect(AdminPermissionModel.create).toHaveBeenCalledTimes(catalogSize);
    expect(result.permissionsCreated).toBe(catalogSize);
    expect(result.permissionsUpdated).toBe(0);
    expect(result.permissionsUnchanged).toBe(0);
    expect(result.grantsCreated).toBe(0);
    expect(UserModel.findOne).not.toHaveBeenCalled();
  });

  it("updates a permission row whose definition drifted from the catalog, and leaves matching rows unchanged", async () => {
    (AdminPermissionModel.findByPk as jest.Mock).mockImplementation((key: string) => {
      const definition = ADMIN_PERMISSION_CATALOG.find((entry) => entry.key === key);
      if (!definition) return Promise.resolve(null);
      const isFirst = key === ADMIN_PERMISSION_CATALOG[0].key;
      return Promise.resolve({
        label: isFirst ? "Etiqueta desactualizada" : definition.label,
        description: definition.description,
        domain: definition.domain,
        update: permissionUpdate,
      });
    });

    const result = await seedAdminPermissions(transaction);

    expect(permissionUpdate).toHaveBeenCalledTimes(1);
    expect(result.permissionsUpdated).toBe(1);
    expect(result.permissionsUnchanged).toBe(catalogSize - 1);
    expect(result.permissionsCreated).toBe(0);
  });

  it("grants the full permission set to the bootstrap admin when the account exists", async () => {
    (AdminPermissionModel.findByPk as jest.Mock).mockResolvedValue({
      label: "x",
      description: "x",
      domain: "x",
      update: permissionUpdate,
    });
    (UserModel.findOne as jest.Mock).mockResolvedValue({ id: "admin-id" });
    (AdminUserPermissionModel.findOne as jest.Mock).mockResolvedValue(null);

    const result = await seedAdminPermissions(transaction, "Admin@Example.com");

    expect(UserModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "admin@example.com" } }),
    );
    expect(grantCreate).toHaveBeenCalledTimes(catalogSize);
    expect(result.grantsCreated).toBe(catalogSize);
  });

  it("does not duplicate a grant the admin already has", async () => {
    (AdminPermissionModel.findByPk as jest.Mock).mockResolvedValue({
      label: "x",
      description: "x",
      domain: "x",
      update: permissionUpdate,
    });
    (UserModel.findOne as jest.Mock).mockResolvedValue({ id: "admin-id" });
    (AdminUserPermissionModel.findOne as jest.Mock).mockResolvedValue({ id: "existing-grant" });

    const result = await seedAdminPermissions(transaction, "admin@example.com");

    expect(grantCreate).not.toHaveBeenCalled();
    expect(result.grantsCreated).toBe(0);
  });

  it("skips granting entirely when the bootstrap admin account does not exist", async () => {
    (AdminPermissionModel.findByPk as jest.Mock).mockResolvedValue({
      label: "x",
      description: "x",
      domain: "x",
      update: permissionUpdate,
    });
    (UserModel.findOne as jest.Mock).mockResolvedValue(null);

    const result = await seedAdminPermissions(transaction, "missing@example.com");

    expect(grantCreate).not.toHaveBeenCalled();
    expect(result.grantsCreated).toBe(0);
  });
});
