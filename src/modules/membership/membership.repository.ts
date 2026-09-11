import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { Op, Transaction, UniqueConstraintError } from "sequelize";
import { EntitlementSource, MembershipStatus, PlanStatus } from "../../common/enums/domain.enums";
import { UserModel } from "../users/user.model";
import { CustomerProfileModel } from "./customer-profile.model";
import { MembershipPlanModel } from "./membership-plan.model";
import { MembershipStatusHistoryModel } from "./membership-status-history.model";
import { MembershipModel } from "./membership.model";
import { PlanAccessScopeModel } from "./plan-access-scope.model";
import { StaffBranchScopeModel } from "./staff-branch-scope.model";
import { StaffProfileModel } from "./staff-profile.model";
import { EntitlementModel } from "./entitlement.model";
import { tenantScopeWhere } from "../../common/tenancy/tenant-scope";
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
    @InjectModel(MediaFileModel)
    private readonly media: typeof MediaFileModel,
  ) {}

  /**
   * Un archivo de media por su código estable. El gimnasio administra piezas
   * operativas (como el QR de cobro) subiéndolas con un código conocido, de
   * modo que reemplazar la imagen no obliga a desplegar el cliente.
   */
  findMediaByCode(code: string) {
    return this.media.findOne({
      where: { code },
      attributes: ["code", "storageUrl", "altText"],
    });
  }

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
      // Fuera de transacción se resuelve también la imagen del plan para que
      // la respuesta administrativa incluya su QR sin una segunda consulta.
      include: transaction
        ? [PlanAccessScopeModel]
        : [PlanAccessScopeModel, MediaFileModel],
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
    return plan.reload({ include: [PlanAccessScopeModel, MediaFileModel] });
  }

  /** Existencia de un archivo de media por id, para validar `imagenId`. */
  findMediaById(mediaFileId: string, transaction?: Transaction) {
    return this.media.findByPk(mediaFileId, {
      attributes: ["id"],
      transaction,
    });
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

  listCustomers(page: number, pageSize: number, tenantScope: string | null) {
    return this.customers.findAndCountAll({
      // `required: true` es lo que convierte el include en filtro: sin él, un
      // socio de otro gimnasio saldria igual con su usuario a null.
      include: [
        { model: UserModel, required: true, where: tenantScopeWhere(tenantScope) },
      ],
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

  /** Códigos de feature de las recompensas de racha ya otorgadas a este usuario. */
  async listGrantedStreakRewardCodes(userId: string): Promise<Set<string>> {
    const grants = await this.entitlements.findAll({
      where: { userId, sourceType: EntitlementSource.STREAK_REWARD },
      attributes: ["featureId"],
    });
    if (grants.length === 0) return new Set();

    const features = await this.features.findAll({
      where: { id: { [Op.in]: grants.map((grant) => grant.featureId) } },
      attributes: ["code"],
    });
    return new Set(features.map((feature) => feature.code));
  }

  /**
   * Otorga un beneficio si todavía no existe uno igual, sin lanzar si ya
   * estaba concedido. `uq_entitlement_source (user_id, feature_id, source_type,
   * source_id)` es quien de verdad garantiza que no se duplique — esto solo
   * evita que una carrera entre dos lecturas concurrentes de la senda se vea
   * como un error en vez de como "ya lo tenía".
   */
  async grantEntitlementIfMissing(input: {
    userId: string;
    featureId: string;
    sourceType: EntitlementSource;
    sourceId: string;
    metadata?: Record<string, unknown>;
  }): Promise<boolean> {
    try {
      await this.entitlements.create({
        userId: input.userId,
        featureId: input.featureId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        status: "ACTIVE",
        startsAt: new Date(),
        endsAt: null,
        metadata: input.metadata ?? {},
      });
      return true;
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) return false;
      throw error;
    }
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

  listMemberships(filters: MembershipListInput, tenantScope: string | null) {
    const where = {
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.estado ? { status: filters.estado } : {}),
    };
    return this.memberships.findAndCountAll({
      where,
      include: [
        MembershipPlanModel,
        // El gimnasio de una membresia es el de su titular: la membresia no lo
        // guarda, asi que el filtro entra por el usuario.
        //
        // `as` es obligatorio aqui: `MembershipModel` declara **dos** relaciones
        // con `UserModel` — el titular (`user`) y quien la dio de alta
        // (`createdByUser`) —, asi que Sequelize no puede deducir cual de las
        // dos se pide y aborta la consulta entera con «Alias cannot be
        // inferred», que el filtro de excepciones convierte en un 500. Sin esto
        // el listado de membresias del panel de administracion no responde.
        {
          model: UserModel,
          as: "user",
          required: true,
          where: tenantScopeWhere(tenantScope),
        },
      ],
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
      // Fuera de transacción se adjunta la cuenta para que la respuesta de
      // alta ya identifique a la persona sin una consulta adicional.
      include: transaction
        ? [StaffBranchScopeModel]
        : [StaffBranchScopeModel, UserModel],
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

  /**
   * Listado paginado de perfiles laborales con su cuenta asociada. Cubre el
   * hueco documentado en `backend-contract-gaps.md`: hasta ahora el personal
   * sólo podía crearse o cambiar de estado conociendo el id de usuario.
   */
  listStaff(
    page: number,
    pageSize: number,
    tenantScope: string | null,
    filters: { position?: string; employmentStatus?: string } = {},
  ) {
    return this.staff.findAndCountAll({
      where: {
        ...(filters.position ? { position: filters.position } : {}),
        ...(filters.employmentStatus
          ? { employmentStatus: filters.employmentStatus }
          : {}),
      },
      include: [
        StaffBranchScopeModel,
        { model: UserModel, required: true, where: tenantScopeWhere(tenantScope) },
      ],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      order: [["hiredOn", "DESC"]],
      distinct: true,
    });
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
