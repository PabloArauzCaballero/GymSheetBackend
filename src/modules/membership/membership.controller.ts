import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { MembershipService } from './membership.service';
import {
  CreateCustomerInput,
  CreateMembershipInput,
  CreatePlanInput,
  CreateStaffInput,
  MembershipListInput,
  MembershipStatusInput,
  ReplacePlanScopesInput,
  UpdatePlanInput,
  UpdateStaffStatusInput,
  createCustomerSchema,
  createMembershipSchema,
  createPlanSchema,
  createStaffSchema,
  membershipListSchema,
  membershipStatusSchema,
  replacePlanScopesSchema,
  updatePlanSchema,
  updateStaffStatusSchema,
} from './membership.schemas';

@Controller('memberships')
export class MembershipController {
  constructor(private readonly service: MembershipService) {}

  @Get('me')
  getMine(@CurrentUser() user: AuthenticatedUser) { return this.service.getMyMembership(user.id); }
}

@Roles(UserRole.ADMIN, UserRole.FRONT_DESK)
@Controller('admin/membership')
export class AdminMembershipController {
  constructor(private readonly service: MembershipService) {}

  @Get('plans')
  listPlans() { return this.service.listPlans(); }

  @Post('plans')
  @Roles(UserRole.ADMIN)
  createPlan(@Body(new ZodValidationPipe(createPlanSchema)) input: CreatePlanInput) { return this.service.createPlan(input); }

  @Patch('plans/:id')
  @Roles(UserRole.ADMIN)
  updatePlan(@Param('id', UuidParamPipe) id: string, @Body(new ZodValidationPipe(updatePlanSchema)) input: UpdatePlanInput) { return this.service.updatePlan(id, input); }

  @Patch('plans/:id/scopes')
  @Roles(UserRole.ADMIN)
  replaceScopes(@Param('id', UuidParamPipe) id: string, @Body(new ZodValidationPipe(replacePlanScopesSchema)) input: ReplacePlanScopesInput) { return this.service.replacePlanScopes(id, input); }

  @Post('customers')
  createCustomer(@Body(new ZodValidationPipe(createCustomerSchema)) input: CreateCustomerInput) { return this.service.createCustomer(input); }

  @Get('customers')
  listCustomers(@Query(new ZodValidationPipe(membershipListSchema)) query: MembershipListInput) { return this.service.listCustomers(query.page, query.pageSize); }

  @Post('memberships')
  createMembership(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(createMembershipSchema)) input: CreateMembershipInput) { return this.service.createMembership(input, user.id); }

  @Get('memberships')
  listMemberships(@Query(new ZodValidationPipe(membershipListSchema)) query: MembershipListInput) { return this.service.listMemberships(query); }

  @Patch('memberships/:id/status')
  changeStatus(@Param('id', UuidParamPipe) id: string, @Body(new ZodValidationPipe(membershipStatusSchema)) input: MembershipStatusInput) { return this.service.changeMembershipStatus(id, input); }

  @Post('staff')
  @Roles(UserRole.ADMIN)
  createStaff(@Body(new ZodValidationPipe(createStaffSchema)) input: CreateStaffInput) { return this.service.createStaff(input); }

  @Patch('staff/:userId/status')
  @Roles(UserRole.ADMIN)
  updateStaffStatus(@Param('userId', UuidParamPipe) userId: string, @Body(new ZodValidationPipe(updateStaffStatusSchema)) input: UpdateStaffStatusInput) { return this.service.updateStaffStatus(userId, input); }
}
