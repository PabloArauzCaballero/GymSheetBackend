import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { UserModel } from '../users/user.model';
import { UsersModule } from '../users/users.module';
import { AdminAccessController } from './admin-access.controller';
import { AdminPermissionModel } from './admin-permission.model';
import { AdminPermissionsRepository } from './admin-permissions.repository';
import { AdminPermissionsService } from './admin-permissions.service';
import { AdminUserPermissionModel } from './admin-user-permission.model';
import { AdminAuditLogModel } from './audit-log.model';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';
import { PermissionGuard } from './permission.guard';

@Module({
  imports: [
    SequelizeModule.forFeature([
      AdminPermissionModel,
      AdminUserPermissionModel,
      AdminAuditLogModel,
      UserModel,
    ]),
    // Para resolver el gimnasio de la cuenta destinataria de una concesión: sin
    // ese dato no se puede comprobar que cae dentro del alcance de quien concede.
    UsersModule,
  ],
  controllers: [AdminAccessController, AuditController],
  providers: [
    AdminPermissionsRepository,
    AdminPermissionsService,
    AuditLogRepository,
    AuditLogService,
    AuditInterceptor,
    PermissionGuard,
  ],
  // `AuditLogService` y `AuditInterceptor` salen del modulo porque `AppModule`
  // registra el interceptor como `APP_INTERCEPTOR`: sin exportarlos, el
  // proveedor global no podria resolverlos.
  exports: [AdminPermissionsService, AuditLogService, AuditInterceptor, PermissionGuard],
})
export class AdminAccessModule {}
