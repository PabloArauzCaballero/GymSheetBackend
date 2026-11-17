import { Module } from '@nestjs/common';
import { BusinessAccountsModule } from '../business-accounts/business-accounts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AffiliationNotices } from './affiliation-notices';
import { AffiliationRequestsService } from './affiliation-requests.service';
import { AffiliationViewsRepository } from './affiliation-views.repository';
import { AffiliationsRepository } from './affiliations.repository';
import { CoachGymLinksController, GymAffiliationsController } from './business-affiliations.controller';
import { GymAffiliationsService } from './gym-affiliations.service';
import { MeAffiliationsController } from './me-affiliations.controller';

/**
 * Affiliations of persons and coach businesses to a gym's directory entity
 * (ADR-0025, franja 7b). Exported for 7c (the current confirmed SOCIO) and 8e
 * (confirm a SOCIO with the order that pays it, `confirmInTransaction`).
 */
@Module({
  imports: [BusinessAccountsModule, NotificationsModule],
  controllers: [MeAffiliationsController, GymAffiliationsController, CoachGymLinksController],
  providers: [AffiliationsRepository, AffiliationViewsRepository, AffiliationNotices, AffiliationRequestsService, GymAffiliationsService],
  exports: [AffiliationsRepository, GymAffiliationsService],
})
export class AffiliationsModule {}
