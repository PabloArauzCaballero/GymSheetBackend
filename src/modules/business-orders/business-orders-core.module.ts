import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { EntityPaymentConfigModel } from '../directory/models/entity-payment-config.model';
import { EntityPlanModel } from '../directory/models/entity-plan.model';
import { PaymentOrderModel } from '../directory/models/payment-order.model';
import { PlanPriceHistoryModel } from '../directory/models/plan-price-history.model';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderLifecycle } from './order-lifecycle.service';
import { OrderMaintenanceService } from './order-maintenance.service';
import { OrderNotices } from './order-notices';
import { OrdersRepository } from './orders.repository';
import { SellersRepository } from './sellers.repository';

/**
 * The order state, its stock and its notices (ADR-0024), without HTTP: shared
 * by the API module and `worker:orders-maintenance`, which needs nothing else.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([PaymentOrderModel, EntityPlanModel, PlanPriceHistoryModel, EntityPaymentConfigModel]),
    NotificationsModule,
  ],
  providers: [OrdersRepository, SellersRepository, OrderLifecycle, OrderNotices, OrderMaintenanceService],
  exports: [OrdersRepository, SellersRepository, OrderLifecycle, OrderNotices, OrderMaintenanceService],
})
export class BusinessOrdersCoreModule {}
