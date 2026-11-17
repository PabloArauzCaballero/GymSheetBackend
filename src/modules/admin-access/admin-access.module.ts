import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AdminAccessController } from './admin-access.controller';
import { AdminAuditLogModel } from './audit-log.model';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';

@Module({
  imports: [SequelizeModule.forFeature([AdminAuditLogModel])],
  controllers: [AdminAccessController, AuditController],
  providers: [AuditLogRepository, AuditLogService, AuditInterceptor],
  // `AuditLogService` y `AuditInterceptor` salen del modulo porque `AppModule`
  // registra el interceptor como `APP_INTERCEPTOR`: sin exportarlos, el
  // proveedor global no podria resolverlos.
  exports: [AuditLogService, AuditInterceptor],
})
export class AdminAccessModule {}
