import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConnectionModel } from '../social/connection.model';
import { DiscoveryPassModel } from '../social/discovery-pass.model';
import {
  ModerationAdminController,
  ReportsController,
} from './moderation.controller';
import { ModerationRepository } from './moderation.repository';
import { ModerationService } from './moderation.service';
import { ModerationReportModel } from './report.model';
import { UserStrikeModel } from './user-strike.model';

@Module({
  imports: [
    SequelizeModule.forFeature([
      ModerationReportModel,
      UserStrikeModel,
      // Denunciar aparta a esa persona de la baraja y rompe la conexión. Se
      // toman los dos modelos y no el repositorio social entero: son dos
      // escrituras puntuales, y depender del módulo completo ataría moderación
      // a la superficie social por una razón mucho más pequeña.
      ConnectionModel,
      DiscoveryPassModel,
    ]),
    NotificationsModule,
  ],
  controllers: [ReportsController, ModerationAdminController],
  providers: [ModerationRepository, ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
