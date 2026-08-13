import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { Op, Transaction } from "sequelize";
import { MembershipStatus, PlanStatus } from "../../common/enums/domain.enums";
import { UserModel } from "../users/user.model";
import { CustomerProfileModel } from "./customer-profile.model";
import { MembershipPlanModel } from "./membership-plan.model";
import { MembershipStatusHistoryModel } from "./membership-status-history.model";
import { MembershipModel } from "./membership.model";
import { PlanAccessScopeModel } from "./plan-access-scope.model";
import { StaffBranchScopeModel } from "./staff-branch-scope.model";
import { StaffProfileModel } from "./staff-profile.model";
import { EntitlementModel } from "./entitlement.model";
import { MediaFileModel } from "./media-file.model";
import { MembershipExtensionModel } from "./membership-extension.model";
import { MembershipFeatureModel } from "./membership-feature.model";
import { MembershipIntentModel } from "./membership-intent.model";
import { PlanFeatureModel } from "./plan-feature.model";
import {
  CreatePlanInput,
  CreateStaffInput,
  MembershipListInput,
  UpdatePlanInput,
} from "./membership.schemas";

@Injectable()
export class MembershipRepository {
  constructor(
    @InjectModel(MembershipPlanModel)
    private readonly plans: typeof MembershipPlanModel,
    @InjectModel(PlanAccessScopeModel)
    private readonly planScopes: typeof PlanAccessScopeModel,
    @InjectModel(MembershipModel)
    private readonly memberships: typeof MembershipModel,
    @InjectModel(MembershipStatusHistoryModel)
    private readonly membershipHistory: typeof MembershipStatusHistoryModel,
    @InjectModel(CustomerProfileModel)
    private readonly customers: typeof CustomerProfileModel,
    @InjectModel(StaffProfileModel)
    private readonly staff: typeof StaffProfileModel,
    @InjectModel(StaffBranchScopeModel)
    private readonly staffScopes: typeof StaffBranchScopeModel,
    @InjectModel(MembershipFeatureModel)
    private readonly features: typeof MembershipFeatureModel,
    @InjectModel(PlanFeatureModel)
    private readonly planFeatures: typeof PlanFeatureModel,
    @InjectModel(EntitlementModel)
    private readonly entitlements: typeof EntitlementModel,
    @InjectModel(MembershipIntentModel)
    private readonly intents: typeof MembershipIntentModel,
    @InjectModel(MembershipExtensionModel)
    private readonly extensions: typeof MembershipExtensionModel,
  ) {}

  listPlans() {
    return this.plans.findAll({
      include: [PlanAccessScopeModel, MediaFileModel],
      order: [
        ["displayOrder", "ASC"],
        ["name", "ASC"],
      ],
    });
  }

  listStorePlans() {
    return this.plans.findAll({
      where: { status: PlanStatus.ACTIVE, priceAmount: { [Op.ne]: null } },
      include: [MediaFileModel],
      order: [
        ["displayOrder", "ASC"],
        ["name", "ASC"],
      ],
    });
  }

  findPlan(planId: string, transaction?: Transaction) {
    return this.plans.findByPk(planId, {
      include: [PlanAccessScopeModel],
      transaction,
      // Restringe FOR UPDATE a la fila del plan: bloquear el LEFT JOIN con
      // plan_access_scopes provoca "FOR UPDATE cannot be applied to the
      // nullable side of an outer join" en PostgreSQL.
      lock: transaction
        ? { level: transaction.LOCK.UPDATE, of: MembershipPlanModel }
        : undefined,
    });
  }

  findStorePlan(planId: string, transaction?: Transaction) {
    return this.plans.findOne({
      where: { id: planId, status: PlanStatus.ACTIVE },
      include: transaction ? undefined : [MediaFileModel, PlanAccessScopeModel],
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
  }

  createPlan(input: Omit<CreatePlanInput, "scopes">, transaction: Transaction) {
    return this.plans.create(input, { transaction });
  }

  async updatePlan(plan: MembershipPlanModel, input: UpdatePlanInput) {
    await plan.update(input);
    return plan.reload({ include: [PlanAccessScopeModel] });
  }

  async replacePlanScopes(
    planId: string,
    scopes: { branchId: string; roomId: string | null }[],
    transaction: Transaction,
  ) {
    await this.planScopes.destroy({ where: { planId }, transaction });
    await this.planScopes.bulkCreate(
      scopes.map((scope) => ({ planId, ...scope })),
      { transaction },
    );
  }

  createCustomer(input: Record<string, unknown>, transaction: Transaction) {
    return this.customers.create(input, { transaction });
  }

  findCustomerByUserId(userId: string) {
    return this.customers.findOne({ where: { userId }, include: [UserModel] });
  }

  listCustomers(page: number, pageSize: number) {
    return this.customers.findAndCountAll({
      include: [UserModel],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      order: [["customerNumber", "ASC"]],
    });
  }

  createMembership(input: Record<string, unknown>, transaction: Transaction) {
    return this.memberships.create(input, { transaction });
  }

  createMembershipHistory(
    input: Record<string, unknown>,
    transaction: Transaction,
  ) {
    return this.membershipHistory.create(input, { transaction });
  }

  findMembership(id: string, transaction?: Transaction) {
    return this.memberships.findByPk(id, {
      include: [
        {
          model: MembershipPlanModel,
          include: [PlanAccessScopeModel],
        },
      ],
      transaction,
      // Bloquea solo la fila de la membresía; los JOIN a plan/scopes son el
      // lado nullable del outer join y PostgreSQL no admite FOR UPDATE ahí.
      lock: transaction
        ? { level: transaction.LOCK.UPDATE, of: MembershipModel }
        : undefined,
    });
  }

  findCurrentMembership(
    userId: string,
    today: string,
    transaction?: Transaction,
  ) {
    return this.memberships.findOne({
      where: {
        userId,
        status: MembershipStatus.ACTIVE,
        startsOn: { [Op.lte]: today },
        endsOn: { [Op.gte]: today },
      },
      include: [
        {
          model: MembershipPlanModel,
          where: { status: PlanStatus.ACTIVE },
          include: [PlanAccessScopeModel],
        },
      ],
      order: [["endsOn", "DESC"]],
      transaction,
      // Igual que findMembership: FOR UPDATE acotado a la fila de la membresía.
      lock: transaction
        ? { level: transaction.LOCK.UPDATE, of: MembershipModel }
        : undefined,
    });
  }

  findLatestMembership(userId: string, transaction?: Transaction) {
    return this.memberships.findOne({
      where: { userId },
      include: transaction
        ? undefined
        : [{ model: MembershipPlanModel, include: [MediaFileModel, PlanAccessScopeModel] }],
      order: [
        ["endsOn", "DESC"],
        ["createdAt", "DESC"],
      ],
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
  }

  listMembershipHistory(userId: string) {
    return this.memberships.findAll({
      where: { userId },
      include: [{ model: MembershipPlanModel, include: [MediaFileModel] }],
      order: [["endsOn", "DESC"]],
    });
  }

  async listPlanFeatures(planId: string) {
    const links = await this.planFeatures.findAll({ where: { planId } });
    return this.features.findAll({
      where: {
        id: { [Op.in]: links.map((item) => item.featureId) },
        status: "ACTIVE",
      },
      order: [["name", "ASC"]],
    });
  }

  listFeatures() {
    return this.features.findAll({ order: [["name", "ASC"]] });
  }

  findFeature(id: string) {
    return this.features.findByPk(id);
  }

  findFeatureByCode(code: string) {
    return this.features.findOne({ where: { code } });
  }

  createFeature(input: Record<string, unknown>) {
    return this.features.create({ ...input, status: "ACTIVE" });
  }

  async updateFeature(
    feature: MembershipFeatureModel,
    input: Record<string, unknown>,
  ) {
    await feature.update(input);
    return feature;
  }

  async attachFeatureToPlan(planId: string, featureId: string) {
    const [link] = await this.planFeatures.findOrCreate({
      where: { planId, featureId },
      defaults: { planId, featureId },
    });
    return link;
  }

  detachFeatureFromPlan(planId: string, featureId: string) {
    return this.planFeatures.destroy({ where: { planId, featureId } });
  }

  async listUserEntitlements(userId: string, now: Date) {
    const grants = await this.entitlements.findAll({
      where: {
        userId,
        status: "ACTIVE",
        startsAt: { [Op.lte]: now },
        [Op.or]: [{ endsAt: null }, { endsAt: { [Op.gte]: now } }],
      },
      order: [["createdAt", "DESC"]],
    });
    const features = await this.features.findAll({
      where: {
        id: { [Op.in]: grants.map((item) => item.featureId) },
        status: "ACTIVE",
      },
    });
    const featureById = new Map(
      features.map((feature) => [feature.id, feature]),
    );
    return grants.flatMap((grant) => {
      const feature = featureById.get(grant.featureId);
      return feature ? [{ grant, feature }] : [];
    });
  }

  findIntentByKey(
    userId: string,
    idempotencyKey: string,
    transaction?: Transaction,
  ) {
    return this.intents.findOne({
      where: { userId, idempotencyKey },
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
  }

  createIntent(input: Record<string, unknown>, transaction: Transaction) {
    return this.intents.create(input, { transaction });
  }

  findIntent(id: string, transaction?: Transaction) {
    return this.intents.findByPk(id, {
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
  }

  findLatestPendingIntent(userId: string) {
    return this.intents.findOne({
      where: { userId, status: "PENDING_PAYMENT" },
      order: [["createdAt", "DESC"]],
    });
  }

  createExtension(input: Record<string, unknown>, transaction: Transaction) {
    return this.extensions.create(input, { transaction });
  }

  listMemberships(filters: MembershipListInput) {
    const where = {
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.estado ? { status: filters.estado } : {}),
    };
    return this.memberships.findAndCountAll({
      where,
      include: [MembershipPlanModel],
      limit: filters.pageSize,
      offset: (filters.page - 1) * filters.pageSize,
      order: [["endsOn", "DESC"]],
    });
  }

  async updateMembership(
    membership: MembershipModel,
    changes: Record<string, unknown>,
    transaction?: Transaction,
  ) {
    await membership.update(changes, { transaction });
    return membership;
  }

  findStaffByUserId(userId: string, transaction?: Transaction) {
    return this.staff.findOne({
      where: { userId },
      include: [StaffBranchScopeModel],
      transaction,
      // FOR UPDATE acotado al perfil de staff; el JOIN a scopes es nullable.
      lock: transaction
        ? { level: transaction.LOCK.UPDATE, of: StaffProfileModel }
        : undefined,
    });
  }

  createStaff(
    input: Omit<CreateStaffInput, "branchIds">,
    transaction: Transaction,
  ) {
    return this.staff.create(input, { transaction });
  }

  async replaceStaffScopes(
    staffProfileId: string,
    branchIds: string[],
    transaction: Transaction,
  ) {
    await this.staffScopes.destroy({ where: { staffProfileId }, transaction });
    await this.staffScopes.bulkCreate(
      branchIds.map((branchId) => ({ staffProfileId, branchId })),
      { transaction },
    );
  }
}
