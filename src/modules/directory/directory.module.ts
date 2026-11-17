import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ProductEvents } from '../../common/tracking/product-events';
import { MembershipModel } from '../membership/membership.model';
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
import { EntityPlanModel } from './models/entity-plan.model';
import { DirectoryPaymentsRepository } from './directory-payments.repository';
import { DirectoryPaymentsService } from './directory-payments.service';
import { PublicDirectoryPaymentsController } from './public-directory-payments.controller';

@Module({
  imports: [
    NotificationsModule,
    SequelizeModule.forFeature([
      CategoryModel,
      DirectoryEntityModel,
      DirectoryEntityCategoryModel,
      DirectoryReviewModel,
      DirectoryReviewReplyModel,
      DirectoryReviewHelpfulModel,
      EntityPlanModel,
      MembershipModel,
    ]),
  ],
  controllers: [
    PublicDirectoryController,
    DirectoryReviewsController,
    PublicDirectoryPaymentsController,
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
