import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { UserModel } from '../users/user.model';
import { AdminAccessController } from './admin-access.controller';
import { AdminPermissionModel } from './admin-permission.model';
import { AdminPermissionsRepository } from './admin-permissions.repository';
import { AdminPermissionsService } from './admin-permissions.service';
import { AdminUserPermissionModel } from './admin-user-permission.model';
import { PermissionGuard } from './permission.guard';

@Module({
  imports: [
    SequelizeModule.forFeature([AdminPermissionModel, AdminUserPermissionModel, UserModel]),
  ],
  controllers: [AdminAccessController],
  providers: [AdminPermissionsRepository, AdminPermissionsService, PermissionGuard],
  exports: [AdminPermissionsService, PermissionGuard],
})
export class AdminAccessModule {}
