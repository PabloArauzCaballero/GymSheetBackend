import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BusinessDateService } from '../../common/time/business-date.service';
import { AccessCredentialModule } from '../access-control/access-credential.module';
import { FacilitiesModule } from '../facilities/facilities.module';
import { UsersModule } from '../users/users.module';
import { CustomerProfileModel } from './customer-profile.model';
import { CustomerStaffService } from './customer-staff.service';
import {
  AdminMembershipController,
  MembershipController,
} from './membership.controller';
import { MembershipPlanModel } from './membership-plan.model';
import { MembershipModel } from './membership.model';
import { MembershipRepository } from './membership.repository';
import { MembershipService } from './membership.service';
import { PlanAccessScopeModel } from './plan-access-scope.model';
import { StaffBranchScopeModel } from './staff-branch-scope.model';
import { StaffProfileModel } from './staff-profile.model';

@Module({
  imports: [
    AccessCredentialModule,
    FacilitiesModule,
    UsersModule,
    SequelizeModule.forFeature([
      MembershipPlanModel,
      PlanAccessScopeModel,
      MembershipModel,
      CustomerProfileModel,
      StaffProfileModel,
      StaffBranchScopeModel,
    ]),
  ],
  controllers: [MembershipController, AdminMembershipController],
  providers: [
    MembershipRepository,
    MembershipService,
    CustomerStaffService,
    BusinessDateService,
  ],
  exports: [
    MembershipRepository,
    MembershipService,
    BusinessDateService,
  ],
})
export class MembershipModule {}
