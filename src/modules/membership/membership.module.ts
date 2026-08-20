import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { BusinessDateService } from "../../common/time/business-date.service";
import { AccessCredentialModule } from "../access-control/access-credential.module";
import { FacilitiesModule } from "../facilities/facilities.module";
import { IntegrationModule } from "../integration/integration.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { UsersModule } from "../users/users.module";
import { CustomerProfileModel } from "./customer-profile.model";
import { CustomerStaffService } from "./customer-staff.service";
import {
  AdminMembershipController,
  MembershipController,
  MembershipStoreController,
} from "./membership.controller";
import { MembershipPlanModel } from "./membership-plan.model";
import { MembershipStatusHistoryModel } from "./membership-status-history.model";
import { MembershipModel } from "./membership.model";
import { MembershipRepository } from "./membership.repository";
import { MembershipActivationRequestModel } from "./membership-activation-request.model";
import { GymInsightsService } from "./gym-insights.service";
import { MembershipActivationService } from "./membership-activation.service";
import { MembershipService } from "./membership.service";
import { PlanAccessScopeModel } from "./plan-access-scope.model";
import { StaffBranchScopeModel } from "./staff-branch-scope.model";
import { StaffProfileModel } from "./staff-profile.model";
import { EntitlementModel } from "./entitlement.model";
import { MediaFileModel } from "./media-file.model";
import { MembershipExtensionModel } from "./membership-extension.model";
import { MembershipFeatureModel } from "./membership-feature.model";
import { MembershipIntentModel } from "./membership-intent.model";
import { PlanFeatureModel } from "./plan-feature.model";

@Module({
  imports: [
    AccessCredentialModule,
    FacilitiesModule,
    IntegrationModule,
    NotificationsModule,
    UsersModule,
    SequelizeModule.forFeature([
      MembershipPlanModel,
      MediaFileModel,
      MembershipFeatureModel,
      PlanFeatureModel,
      EntitlementModel,
      MembershipIntentModel,
      MembershipActivationRequestModel,
      MembershipExtensionModel,
      PlanAccessScopeModel,
      MembershipModel,
      MembershipStatusHistoryModel,
      CustomerProfileModel,
      StaffProfileModel,
      StaffBranchScopeModel,
    ]),
  ],
  controllers: [
    MembershipController,
    MembershipStoreController,
    AdminMembershipController,
  ],
  providers: [
    MembershipRepository,
    MembershipService,
    MembershipActivationService,
    GymInsightsService,
    CustomerStaffService,
    BusinessDateService,
  ],
  exports: [MembershipRepository, MembershipService, BusinessDateService],
})
export class MembershipModule {}
