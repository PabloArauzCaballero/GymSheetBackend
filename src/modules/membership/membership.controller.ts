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
import { GymInsightsService } from "./gym-insights.service";
import { MembershipActivationService } from "./membership-activation.service";
import { MembershipService } from "./membership.service";
import {
  ActivationConfirmInput,
  ActivationRequestInput,
  CreateCustomerInput,
  CreateFeatureInput,
  CreateMembershipInput,
  CreatePlanInput,
  CreateStaffInput,
  CreateStaffUserInput,
  MembershipIntentInput,
  MembershipListInput,
  MembershipStatusInput,
  ReplacePlanScopesInput,
  StaffListInput,
  UpdateFeatureInput,
  UpdatePlanInput,
  UpdateStaffStatusInput,
  activationConfirmSchema,
  activationRequestSchema,
  createCustomerSchema,
  createFeatureSchema,
  createMembershipSchema,
  createPlanSchema,
  createStaffSchema,
  createStaffUserSchema,
  membershipIntentSchema,
  membershipListSchema,
  membershipStatusSchema,
  replacePlanScopesSchema,
  staffListSchema,
  updateFeatureSchema,
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
  constructor(
    private readonly service: MembershipService,
    private readonly activation: MembershipActivationService,
    private readonly insights: GymInsightsService,
  ) {}

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
  /**
   * Pide que un administrador active la cuenta tras un pago fuera de la app.
   *
   * Devuelve el enlace ya compuesto, no un identificador que el cliente tenga
   * que armar: quien pulsa esto está bloqueado y con prisa, y cada paso extra
   * es una oportunidad de abandonar.
   */
  @Post("me/membership/activation-request") activationRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(activationRequestSchema))
    input: ActivationRequestInput,
  ) {
    return this.activation.request(user.id, input.nota ?? null);
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
  constructor(
    private readonly service: MembershipService,
    private readonly activation: MembershipActivationService,
    private readonly insights: GymInsightsService,
  ) {}

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

  /**
   * A quién activaría este enlace. Sólo lectura, y protegido como todo lo
   * demás de este controlador: el enlace identifica a la persona, pero quien
   * decide sigue teniendo que ser un administrador con sesión.
   */
  @Get("activation/:token")
  @Roles(UserRole.ADMIN, UserRole.FRONT_DESK)
  describeActivation(@Param("token") token: string) {
    return this.activation.describe(token);
  }

  /** Confirma la activación con el plan elegido. */
  @Post("activation/:token")
  @Roles(UserRole.ADMIN, UserRole.FRONT_DESK)
  confirmActivation(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(activationConfirmSchema))
    input: ActivationConfirmInput,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.activation.confirm(token, input.planId, admin.id);
  }

  /**
   * Uso por máquina en una ventana de días. La ventana llega por consulta y no
   * fija: el panel deja cambiarla, y quien mira decide si le importa la semana
   * o el trimestre.
   */
  @Get("insights/equipment-usage")
  @Roles(UserRole.ADMIN, UserRole.FRONT_DESK)
  equipmentUsage(@Query("days") days?: string) {
    return this.insights.equipmentUsage(readWindow(days));
  }

  /** Actividad en la app y entradas físicas, día a día. */
  @Get("insights/people-flow")
  @Roles(UserRole.ADMIN, UserRole.FRONT_DESK)
  peopleFlow(@Query("days") days?: string) {
    return this.insights.peopleFlow(readWindow(days));
  }

  /** Todas las cuentas, con su membresía y su última actividad resueltas. */
  @Get("users")
  @Roles(UserRole.ADMIN, UserRole.FRONT_DESK)
  listUsers(@Query("q") q?: string, @Query("limit") limit?: string) {
    const parsed = Number(limit);
    const bounded = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 500) : 200;
    const filtro = q?.trim() ? q.trim() : null;
    return this.insights.listUsers(bounded, filtro);
  }

  /** Personas cuya membresía venció o que nunca tuvieron una. */
  @Get("insights/lapsed")
  @Roles(UserRole.ADMIN, UserRole.FRONT_DESK)
  lapsed(@Query("limit") limit?: string) {
    const parsed = Number(limit);
    const bounded = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50;
    return this.insights.lapsedMembers(bounded);
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
    @Query(new ZodValidationPipe(membershipListSchema))
    query: MembershipListInput,
  ) {
    return this.service.listCustomers(query.page, query.pageSize);
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
    @Query(new ZodValidationPipe(membershipListSchema))
    query: MembershipListInput,
  ) {
    return this.service.listMemberships(query);
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
    @Query(new ZodValidationPipe(staffListSchema)) query: StaffListInput,
  ) {
    return this.service.listStaff(query);
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

/**
 * Ventana temporal de un informe, acotada.
 *
 * Sin tope, un `?days=100000` obliga a la base a recorrer todo el histórico por
 * una petición cualquiera. 90 días cubre el trimestre, que es el horizonte con
 * el que un gimnasio decide comprar una máquina.
 */
function readWindow(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(Math.max(Math.trunc(parsed), 1), 90);
}
