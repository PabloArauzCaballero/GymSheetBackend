import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { DomainEventModel } from './domain-event.model';
import { DomainEventPublisher } from './domain-event.publisher';
import { DomainEventRepository } from './domain-event.repository';
import { OutboxJobModel } from './outbox-job.model';
import { OutboxMetricsService } from './outbox-metrics.service';
import { OutboxRepository } from './outbox.repository';
import { OutboxRetentionService } from './outbox-retention.service';
import { OutboxService } from './outbox.service';

@Module({
  imports: [
    SequelizeModule.forFeature([DomainEventModel, OutboxJobModel]),
  ],
  providers: [
    DomainEventRepository,
    DomainEventPublisher,
    OutboxRepository,
    OutboxService,
    OutboxMetricsService,
    OutboxRetentionService,
  ],
  exports: [
    DomainEventRepository,
    DomainEventPublisher,
    OutboxRepository,
    OutboxService,
    OutboxMetricsService,
    OutboxRetentionService,
    SequelizeModule,
  ],
})
export class IntegrationModule {}
