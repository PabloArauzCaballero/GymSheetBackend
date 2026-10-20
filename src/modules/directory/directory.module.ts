import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ProductEvents } from '../../common/tracking/product-events';
import { AccessDecisionModel } from '../access-control/access-decision.model';
import { MembershipPlanModel } from '../membership/membership-plan.model';
import { PlanAccessScopeModel } from '../membership/plan-access-scope.model';
import { MembershipModel } from '../membership/membership.model';
import { MembershipModule } from '../membership/membership.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CategoryModel } from './category.model';
import { DirectoryEntityCategoryModel } from './directory-entity-category.model';
import { DirectoryEntityModel } from './directory-entity.model';
import { DirectoryReviewHelpfulModel } from './directory-review-helpful.model';
import { DirectoryReviewReplyModel } from './directory-review-reply.model';
import { DirectoryReviewModel } from './directory-review.model';
import { DirectoryRepository } from './directory.repository';
import { DirectoryReviewsController } from './directory-reviews.controller';
import { DirectoryService } from './directory.service';
import { PublicDirectoryController } from './public-directory.controller';
import { EntityPaymentConfigModel } from './models/entity-payment-config.model';
import { EntityPlanModel } from './models/entity-plan.model';
import { PlanPriceHistoryModel } from './models/plan-price-history.model';
import { PaymentOrderModel } from './models/payment-order.model';
import { DirectoryPaymentsRepository } from './directory-payments.repository';
import { DirectoryPaymentsService } from './directory-payments.service';
import { PublicDirectoryPaymentsController } from './public-directory-payments.controller';
import { DirectoryPaymentsController } from './directory-payments.controller';
import { AdminDirectoryPaymentsController } from './admin-directory-payments.controller';

@Module({
  imports: [
    MembershipModule,
    NotificationsModule,
    SequelizeModule.forFeature([
      CategoryModel,
      DirectoryEntityModel,
      DirectoryEntityCategoryModel,
      DirectoryReviewModel,
      DirectoryReviewReplyModel,
      DirectoryReviewHelpfulModel,
      EntityPaymentConfigModel,
      EntityPlanModel,
      PlanPriceHistoryModel,
      PaymentOrderModel,
      MembershipModel,
      MembershipPlanModel,
      PlanAccessScopeModel,
      AccessDecisionModel,
    ]),
  ],
  controllers: [
    PublicDirectoryController,
    DirectoryReviewsController,
    PublicDirectoryPaymentsController,
    DirectoryPaymentsController,
    AdminDirectoryPaymentsController,
  ],
  providers: [
    ProductEvents,
    DirectoryRepository,
    DirectoryService,
    DirectoryPaymentsRepository,
    DirectoryPaymentsService,
  ],
  exports: [DirectoryService, DirectoryPaymentsService],
})
export class DirectoryModule {}
