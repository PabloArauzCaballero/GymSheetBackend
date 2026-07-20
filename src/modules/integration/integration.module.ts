import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { DomainEventModel } from './domain-event.model';
import { DomainEventPublisher } from './domain-event.publisher';
import { DomainEventRepository } from './domain-event.repository';
import { OutboxJobModel } from './outbox-job.model';
import { OutboxRepository } from './outbox.repository';
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
  ],
  exports: [
    DomainEventRepository,
    DomainEventPublisher,
    OutboxRepository,
    OutboxService,
    SequelizeModule,
  ],
})
export class IntegrationModule {}
