import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AdminAccessModule } from '../admin-access/admin-access.module';
import { BusinessAccountsModule } from '../business-accounts/business-accounts.module';
import { EntityPlanModel } from '../directory/models/entity-plan.model';
import { PlanPriceHistoryModel } from '../directory/models/plan-price-history.model';
import { MediaModule } from '../media/media.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminListingsController } from './admin-listings.controller';
import { AdminListingsService } from './admin-listings.service';
import { BusinessListingsController } from './business-listings.controller';
import { BusinessListingsRepository } from './business-listings.repository';
import { BusinessListingsService } from './business-listings.service';
import { BusinessLocationsController } from './business-locations.controller';
import { BusinessLocationsService } from './business-locations.service';
import { EntityLocationsRepository } from './entity-locations.repository';
import { ListingMediaService } from './listing-media.service';
import { ListingPublicationService } from './listing-publication.service';
import { PublicListingsController } from './public-listings.controller';
import { PublicListingsRepository } from './public-listings.repository';
import { PublicListingsService } from './public-listings.service';

/** Public business profile, locations and listings with post-moderation (ADR-0022, franja 8c). */
@Module({
  imports: [
    SequelizeModule.forFeature([EntityPlanModel, PlanPriceHistoryModel]),
    BusinessAccountsModule,
    MediaModule,
    NotificationsModule,
    AdminAccessModule,
  ],
  controllers: [BusinessListingsController, BusinessLocationsController, PublicListingsController, AdminListingsController],
  providers: [
    BusinessListingsRepository,
    BusinessListingsService,
    ListingPublicationService,
    ListingMediaService,
    EntityLocationsRepository,
    BusinessLocationsService,
    PublicListingsRepository,
    PublicListingsService,
    AdminListingsService,
  ],
})
export class BusinessListingsModule {}
