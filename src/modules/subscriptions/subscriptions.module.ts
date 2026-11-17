import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BusinessDateService } from '../../common/time/business-date.service';
import { AffiliationsModule } from '../affiliations/affiliations.module';
import { BusinessAccountsModule } from '../business-accounts/business-accounts.module';
import { IntegrationModule } from '../integration/integration.module';
import { MembershipStatusHistoryModel } from '../membership/membership-status-history.model';
import { MembershipModel } from '../membership/membership.model';
import { NotificationsModule } from '../notifications/notifications.module';
import { BusinessSubscriptionsService } from './business-subscriptions.service';
import { MeSubscriptionsService } from './me-subscriptions.service';
import { SubscriptionLedgerRepository } from './subscription-ledger.repository';
import { SubscriptionLedgerService } from './subscription-ledger.service';
import { SubscriptionNotices } from './subscription-notices';
import { SubscriptionViewsRepository } from './subscription-views.repository';
import { BusinessSubscriptionsController, MeSubscriptionsController } from './subscriptions.controller';

/**
 * Unified subscriptions (ADR-0026, franja 8e): the ledger of periods paid by
 * confirmed marketplace orders. Exports the ledger service, which the order
 * confirmation calls inside its own transaction.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([MembershipModel, MembershipStatusHistoryModel]),
    AffiliationsModule,
    BusinessAccountsModule,
    IntegrationModule,
    NotificationsModule,
  ],
  controllers: [MeSubscriptionsController, BusinessSubscriptionsController],
  providers: [
    BusinessDateService,
    SubscriptionLedgerRepository,
    SubscriptionViewsRepository,
    SubscriptionLedgerService,
    SubscriptionNotices,
    MeSubscriptionsService,
    BusinessSubscriptionsService,
  ],
  exports: [SubscriptionLedgerService],
})
export class SubscriptionsModule {}
