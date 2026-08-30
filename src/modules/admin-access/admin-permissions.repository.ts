import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { AdminPermissionModel } from './admin-permission.model';
import { AdminUserPermissionModel } from './admin-user-permission.model';

@Injectable()
export class AdminPermissionsRepository {
  constructor(
    @InjectModel(AdminPermissionModel)
    private readonly permissionModel: typeof AdminPermissionModel,
    @InjectModel(AdminUserPermissionModel)
    private readonly userPermissionModel: typeof AdminUserPermissionModel,
  ) {}

  findByKey(key: string): Promise<AdminPermissionModel | null> {
    return this.permissionModel.findByPk(key);
  }

  findActiveGrantsForUser(userId: string): Promise<AdminUserPermissionModel[]> {
    return this.userPermissionModel.findAll({
      where: {
        userId,
        [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }],
      },
    });
  }

  findGrantsForUser(userId: string): Promise<AdminUserPermissionModel[]> {
    return this.userPermissionModel.findAll({
      where: { userId },
      include: [{ model: AdminPermissionModel }],
      order: [['createdAt', 'DESC']],
    });
  }

  async grant(
    userId: string,
    permissionKey: string,
    grantedByUserId: string,
    expiresAt: Date | null,
  ): Promise<AdminUserPermissionModel> {
    const existing = await this.userPermissionModel.findOne({ where: { userId, permissionKey } });
    if (existing) {
      await existing.update({ grantedByUserId, expiresAt, grantedAt: new Date() });
      return existing;
    }
    return this.userPermissionModel.create({
      userId,
      permissionKey,
      grantedByUserId,
      expiresAt,
      grantedAt: new Date(),
    });
  }

  async revoke(userId: string, permissionKey: string): Promise<boolean> {
    const deletedCount = await this.userPermissionModel.destroy({ where: { userId, permissionKey } });
    return deletedCount > 0;
  }
}
