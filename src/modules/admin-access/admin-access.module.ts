import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { UserModel } from '../users/user.model';
import { UsersModule } from '../users/users.module';
import { AdminAccessController } from './admin-access.controller';
import { AdminPermissionModel } from './admin-permission.model';
import { AdminPermissionsRepository } from './admin-permissions.repository';
import { AdminPermissionsService } from './admin-permissions.service';
import { AdminUserPermissionModel } from './admin-user-permission.model';
import { PermissionGuard } from './permission.guard';

@Module({
  imports: [
    SequelizeModule.forFeature([AdminPermissionModel, AdminUserPermissionModel, UserModel]),
    // Para resolver el gimnasio de la cuenta destinataria de una concesión: sin
    // ese dato no se puede comprobar que cae dentro del alcance de quien concede.
    UsersModule,
  ],
  controllers: [AdminAccessController],
  providers: [AdminPermissionsRepository, AdminPermissionsService, PermissionGuard],
  exports: [AdminPermissionsService, PermissionGuard],
})
export class AdminAccessModule {}
