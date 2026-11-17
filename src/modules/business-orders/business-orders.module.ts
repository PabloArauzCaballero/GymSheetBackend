import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AdminAccessModule } from '../admin-access/admin-access.module';
import { BusinessAccountsModule } from '../business-accounts/business-accounts.module';
import { DirectoryEntityModel } from '../directory/directory-entity.model';
import { EntityPlanModel } from '../directory/models/entity-plan.model';
import { MediaModule } from '../media/media.module';
import { MembershipPlanModel } from '../membership/membership-plan.model';
import { MembershipModule } from '../membership/membership.module';
import { PlanAccessScopeModel } from '../membership/plan-access-scope.model';
import { ModerationModule } from '../moderation/moderation.module';
import { AdminOrderEvidenceController } from './admin-order-evidence.controller';
import { BusinessOrdersCoreModule } from './business-orders-core.module';
import { BusinessOrdersController, PaymentConfigController } from './business-orders.controller';
import { BusinessOrdersService } from './business-orders.service';
import { BuyerOrdersController } from './buyer-orders.controller';
import { BuyerOrdersService } from './buyer-orders.service';
import { OrderMembershipBridge } from './order-membership-bridge';
import { OrderPaymentService } from './order-payment.service';
import { PAYMENT_EVIDENCE_CIPHER, PaymentEvidenceStore, paymentEvidenceCipher } from './payment-evidence.store';
import { PaymentConfigService } from './payment-config.service';

/** Marketplace orders paid by the business's QR or in cash, confirmed by the business (ADR-0024, franja 8d). */
@Module({
  imports: [
    SequelizeModule.forFeature([DirectoryEntityModel, EntityPlanModel, MembershipPlanModel, PlanAccessScopeModel]),
    BusinessOrdersCoreModule,
    BusinessAccountsModule,
    MediaModule,
    MembershipModule,
    ModerationModule,
    AdminAccessModule,
  ],
  controllers: [BuyerOrdersController, BusinessOrdersController, PaymentConfigController, AdminOrderEvidenceController],
  providers: [
    { provide: PAYMENT_EVIDENCE_CIPHER, useFactory: paymentEvidenceCipher },
    PaymentEvidenceStore,
    BuyerOrdersService,
    OrderPaymentService,
    BusinessOrdersService,
    PaymentConfigService,
    OrderMembershipBridge,
  ],
})
export class BusinessOrdersModule {}
