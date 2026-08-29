import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../../common/enums/domain.enums";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { MembershipService } from "./membership.service";
import {
  CreateCustomerInput,
  CreateFeatureInput,
  CreateMembershipInput,
  CreatePlanInput,
  CreateStaffInput,
  CreateStaffUserInput,
  MembershipListInput,
  MembershipStatusInput,
  ReplacePlanScopesInput,
  StaffListInput,
  UpdateFeatureInput,
  UpdatePlanInput,
  UpdateStaffStatusInput,
  createCustomerSchema,
  createFeatureSchema,
  createMembershipSchema,
  createPlanSchema,
  createStaffSchema,
  createStaffUserSchema,
  updateFeatureSchema,
  membershipListSchema,
  membershipStatusSchema,
  membershipIntentSchema,
  MembershipIntentInput,
  replacePlanScopesSchema,
  staffListSchema,
  updatePlanSchema,
  updateStaffStatusSchema,
} from "./membership.schemas";

@Controller("memberships")
export class MembershipController {
  constructor(private readonly service: MembershipService) {}

  @Get("me")
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getMyMembership(user.id);
  }
}

@Controller()
export class MembershipStoreController {
  constructor(private readonly service: MembershipService) {}

  @Get("membership/plans") listPlans() {
    return this.service.listStorePlans();
  }
  @Get("membership/plans/:id") getPlan(@Param("id", UuidParamPipe) id: string) {
    return this.service.getStorePlan(id);
  }
  @Get("me/membership") getMembership(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getMyMembershipProjection(user.id);
  }
  @Get("me/accesses") getAccesses(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getMyAccesses(user.id);
  }
  @Get("me/membership/options") getOptions(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getMyOptions(user.id);
  }
  @Post("me/membership/renewal-intent") renewal(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(membershipIntentSchema))
    input: MembershipIntentInput,
  ) {
    return this.service.createRenewalIntent(user.id, input);
  }
  @Post("me/membership/extension-intent") extension(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(membershipIntentSchema))
    input: MembershipIntentInput,
  ) {
    return this.service.createExtensionIntent(user.id, input);
  }
}

@Roles(UserRole.ADMIN, UserRole.FRONT_DESK)
@Controller("admin/membership")
export class AdminMembershipController {
  constructor(private readonly service: MembershipService) {}

  @Get("plans")
  listPlans() {
    return this.service.listPlans();
  }

  @Post("plans")
  @Roles(UserRole.ADMIN)
  createPlan(
    @Body(new ZodValidationPipe(createPlanSchema)) input: CreatePlanInput,
  ) {
    return this.service.createPlan(input);
  }

  @Patch("plans/:id")
  @Roles(UserRole.ADMIN)
  updatePlan(
    @Param("id", UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updatePlanSchema)) input: UpdatePlanInput,
  ) {
    return this.service.updatePlan(id, input);
  }

  @Get("features")
  listFeatures() {
    return this.service.listFeatures();
  }

  @Post("features")
  @Roles(UserRole.ADMIN)
  createFeature(
    @Body(new ZodValidationPipe(createFeatureSchema))
    input: CreateFeatureInput,
  ) {
    return this.service.createFeature(input);
  }

  @Patch("features/:id")
  @Roles(UserRole.ADMIN)
  updateFeature(
    @Param("id", UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateFeatureSchema))
    input: UpdateFeatureInput,
  ) {
    return this.service.updateFeature(id, input);
  }

  @Delete("features/:id")
  @Roles(UserRole.ADMIN)
  deactivateFeature(@Param("id", UuidParamPipe) id: string) {
    return this.service.deactivateFeature(id);
  }

  @Post("plans/:planId/features/:featureId")
  @Roles(UserRole.ADMIN)
  attachFeature(
    @Param("planId", UuidParamPipe) planId: string,
    @Param("featureId", UuidParamPipe) featureId: string,
  ) {
    return this.service.attachFeatureToPlan(planId, featureId);
  }

  @Delete("plans/:planId/features/:featureId")
  @Roles(UserRole.ADMIN)
  detachFeature(
    @Param("planId", UuidParamPipe) planId: string,
    @Param("featureId", UuidParamPipe) featureId: string,
  ) {
    return this.service.detachFeatureFromPlan(planId, featureId);
  }

  @Patch("plans/:id/scopes")
  @Roles(UserRole.ADMIN)
  replaceScopes(
    @Param("id", UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(replacePlanScopesSchema))
    input: ReplacePlanScopesInput,
  ) {
    return this.service.replacePlanScopes(id, input);
  }

  @Post("customers")
  createCustomer(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(createCustomerSchema))
    input: CreateCustomerInput,
  ) {
    return this.service.createCustomer(input, actor.id);
  }

  @Get("customers")
  listCustomers(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(new ZodValidationPipe(membershipListSchema))
    query: MembershipListInput,
  ) {
    return this.service.listCustomers(query.page, query.pageSize, actor.tenantScope);
  }

  @Post("memberships")
  createMembership(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(createMembershipSchema))
    input: CreateMembershipInput,
  ) {
    return this.service.createMembership(input, actor.id);
  }

  @Get("memberships")
  listMemberships(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(new ZodValidationPipe(membershipListSchema))
    query: MembershipListInput,
  ) {
    return this.service.listMemberships(query, actor.tenantScope);
  }

  @Patch("memberships/:id/status")
  changeStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(membershipStatusSchema))
    input: MembershipStatusInput,
  ) {
    return this.service.changeMembershipStatus(id, input, actor.id);
  }

  @Post("staff")
  @Roles(UserRole.ADMIN)
  createStaff(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(createStaffSchema)) input: CreateStaffInput,
  ) {
    return this.service.createStaff(input, actor.id);
  }

  /** Alta de cuenta y perfil laboral en un solo paso (entrenadores, recepción). */
  @Post("staff-users")
  @Roles(UserRole.ADMIN)
  createStaffUser(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(createStaffUserSchema))
    input: CreateStaffUserInput,
  ) {
    return this.service.createStaffUser(input, actor.id);
  }

  @Get("staff")
  @Roles(UserRole.ADMIN)
  listStaff(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(new ZodValidationPipe(staffListSchema)) query: StaffListInput,
  ) {
    return this.service.listStaff(query, actor.tenantScope);
  }

  @Patch("staff/:userId/status")
  @Roles(UserRole.ADMIN)
  updateStaffStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("userId", UuidParamPipe) userId: string,
    @Body(new ZodValidationPipe(updateStaffStatusSchema))
    input: UpdateStaffStatusInput,
  ) {
    return this.service.updateStaffStatus(userId, input, actor.id);
  }

  @Post("intents/:id/confirm")
  @Roles(UserRole.ADMIN)
  confirmIntent(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", UuidParamPipe) id: string,
  ) {
    return this.service.confirmIntent(id, actor.id);
  }
}
