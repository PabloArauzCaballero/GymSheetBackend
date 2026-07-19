import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { OutboxJobModel } from './outbox-job.model';
import { OutboxRepository } from './outbox.repository';
import { OutboxService } from './outbox.service';

@Module({
  imports: [SequelizeModule.forFeature([OutboxJobModel])],
  providers: [OutboxRepository, OutboxService],
  exports: [OutboxRepository, OutboxService, SequelizeModule],
})
export class IntegrationModule {}
