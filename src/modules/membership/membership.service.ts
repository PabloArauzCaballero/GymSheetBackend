import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Sequelize } from "sequelize-typescript";
import {
  MembershipStatus,
  PlanStatus,
  UserRole,
} from "../../common/enums/domain.enums";
import { BusinessDateService } from "../../common/time/business-date.service";
import { FacilitiesRepository } from "../facilities/facilities.repository";
import { GymDomainEvent } from "../integration/domain-event.catalog";
import { DomainEventPublisher } from "../integration/domain-event.publisher";
import { UsersRepository } from "../users/users.repository";
import { CustomerStaffService } from "./customer-staff.service";
import { mapMembership, mapPlan } from "./membership.mapper";
import { env } from "../../config/env";
import { MembershipRepository } from "./membership.repository";
import {
  CreateCustomerInput,
  CreateMembershipInput,
  CreatePlanInput,
  CreateStaffInput,
  MembershipListInput,
  MembershipStatusInput,
  MembershipIntentInput,
  ReplacePlanScopesInput,
  UpdatePlanInput,
  UpdateStaffStatusInput,
} from "./membership.schemas";

export const MEMBERSHIP_RENEWAL_MESSAGE = "Hola, quisiera renovar mi membresía";

export function buildMembershipWhatsAppUrl(phone: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(MEMBERSHIP_RENEWAL_MESSAGE)}`;
}

@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);
  constructor(
    private readonly repository: MembershipRepository,
    private readonly usersRepository: UsersRepository,
    private readonly facilitiesRepository: FacilitiesRepository,
    private readonly customerStaff: CustomerStaffService,
    private readonly events: DomainEventPublisher,
    private readonly dates: BusinessDateService,
    private readonly sequelize: Sequelize,
  ) {}

  async listPlans() {
    return (await this.repository.listPlans()).map(mapPlan);
  }

  async listStorePlans() {
    return (await this.repository.listStorePlans()).map(mapPlan);
  }

  async getStorePlan(planId: string) {
    const plan = await this.repository.findStorePlan(planId);
    if (!plan)
      throw new NotFoundException("Plan no encontrado o no disponible.");
    return mapPlan(plan);
  }

  async createPlan(input: CreatePlanInput) {
    await this.validateScopes(input.scopes);
    const planId = await this.sequelize.transaction(async (transaction) => {
      const { scopes, ...attributes } = input;
      const created = await this.repository.createPlan(attributes, transaction);
      await this.repository.replacePlanScopes(created.id, scopes, transaction);
      return created.id;
    });
    return mapPlan(this.requirePlan(await this.repository.findPlan(planId)));
  }

  async updatePlan(planId: string, input: UpdatePlanInput) {
    const plan = await this.repository.findPlan(planId);
    if (!plan) throw new NotFoundException("Plan no encontrado.");
    return mapPlan(await this.repository.updatePlan(plan, input));
  }

  async replacePlanScopes(planId: string, input: ReplacePlanScopesInput) {
    await this.validateScopes(input.scopes);
    await this.sequelize.transaction(async (transaction) => {
      const plan = await this.repository.findPlan(planId, transaction);
      if (!plan) throw new NotFoundException("Plan no encontrado.");
      await this.repository.replacePlanScopes(
        planId,
        input.scopes,
        transaction,
      );
    });
    return mapPlan(this.requirePlan(await this.repository.findPlan(planId)));
  }

  createCustomer(input: CreateCustomerInput, actorUserId: string) {
    return this.customerStaff.createCustomer(input, actorUserId);
  }

  listCustomers(page: number, pageSize: number) {
    return this.customerStaff.listCustomers(page, pageSize);
  }

  createStaff(input: CreateStaffInput, actorUserId: string) {
    return this.customerStaff.createStaff(input, actorUserId);
  }

  updateStaffStatus(
    userId: string,
    input: UpdateStaffStatusInput,
    actorUserId: string,
  ) {
    return this.customerStaff.updateStaffStatus(userId, input, actorUserId);
  }

  async createMembership(input: CreateMembershipInput, actorUserId: string) {
    const membershipId = await this.sequelize.transaction(
      async (transaction) => {
        const user = await this.usersRepository.findById(
          input.userId,
          transaction,
        );
        const plan = await this.repository.findPlan(input.planId, transaction);

        if (!user || user.role !== UserRole.CLIENT) {
          throw new UnprocessableEntityException(
            "El cliente no existe o no tiene rol de cliente.",
          );
        }
        if (!plan || plan.status !== PlanStatus.ACTIVE) {
          throw new UnprocessableEntityException(
            "El plan no existe o está inactivo.",
          );
        }

        const startsOn = input.startsOn ?? this.dates.today();
        const endsOn = this.dates.addDays(startsOn, plan.durationDays - 1);
        const membership = await this.repository.createMembership(
          {
            ...input,
            startsOn,
            endsOn,
            createdByUserId: actorUserId,
            status: MembershipStatus.ACTIVE,
          },
          transaction,
        );
        const event = await this.events.record(
          {
            eventName: GymDomainEvent.MEMBERSHIP_ACTIVATED,
            aggregateType: "membership",
            aggregateId: membership.id,
            deduplicationKey: `membership.activated:${membership.id}`,
            actorUserId,
            payload: {
              membershipId: membership.id,
              userId: input.userId,
              planId: input.planId,
              startsOn,
              endsOn,
            },
          },
          transaction,
        );
        await this.repository.createMembershipHistory(
          {
            membershipId: membership.id,
            fromStatus: null,
            toStatus: MembershipStatus.ACTIVE,
            reason: null,
            actorUserId,
            domainEventId: event.id,
            metadata: {},
          },
          transaction,
        );
        return membership.id;
      },
    );

    return mapMembership(
      this.requireMembership(
        await this.repository.findMembership(membershipId),
      ),
      this.dates,
    );
  }

  async changeMembershipStatus(
    id: string,
    input: MembershipStatusInput,
    actorUserId: string,
  ) {
    const membership = await this.sequelize.transaction(async (transaction) => {
      const current = await this.repository.findMembership(id, transaction);
      if (!current) {
        throw new NotFoundException("Membresía no encontrada.");
      }
      if (
        current.status === MembershipStatus.CANCELLED &&
        input.status !== MembershipStatus.CANCELLED
      ) {
        throw new ConflictException(
          "Una membresía cancelada no puede reactivarse.",
        );
      }
      if (current.status === input.status) return current;

      const fromStatus = current.status;
      const updated = await this.repository.updateMembership(
        current,
        {
          status: input.status,
          notes: input.reason
            ? [current.notes, input.reason].filter(Boolean).join("\n")
            : current.notes,
          suspendedAt:
            input.status === MembershipStatus.SUSPENDED ? new Date() : null,
          cancelledAt:
            input.status === MembershipStatus.CANCELLED
              ? new Date()
              : current.cancelledAt,
        },
        transaction,
      );
      const event = await this.events.record(
        {
          eventName: GymDomainEvent.MEMBERSHIP_STATUS_CHANGED,
          aggregateType: "membership",
          aggregateId: current.id,
          deduplicationKey: `membership.status-changed:${current.id}:${randomUUID()}`,
          actorUserId,
          payload: {
            membershipId: current.id,
            userId: current.userId,
            fromStatus,
            toStatus: input.status,
            reason: input.reason,
          },
        },
        transaction,
      );
      await this.repository.createMembershipHistory(
        {
          membershipId: current.id,
          fromStatus,
          toStatus: input.status,
          reason: input.reason,
          actorUserId,
          domainEventId: event.id,
          metadata: {},
        },
        transaction,
      );
      return updated;
    });

    return mapMembership(membership, this.dates);
  }

  async getMyMembership(userId: string) {
    const membership = await this.repository.findCurrentMembership(
      userId,
      this.dates.today(),
    );
    if (!membership) {
      throw new NotFoundException("No existe una membresía vigente.");
    }
    return mapMembership(membership, this.dates);
  }

  async getMyMembershipProjection(userId: string) {
    const [membership, history, pendingIntent] = await Promise.all([
      this.repository.findLatestMembership(userId),
      this.repository.listMembershipHistory(userId),
      this.repository.findLatestPendingIntent(userId),
    ]);
    const effective = membership
      ? this.mapEffectiveMembership(membership)
      : null;
    return {
      membership: effective,
      history: history.map((item) => this.mapEffectiveMembership(item)),
      paymentStatus: pendingIntent?.status ?? null,
      renewalActions: effective ? this.renewalActions(effective.estado) : [],
    };
  }

  async getMyAccesses(userId: string) {
    const membership = await this.repository.findCurrentMembership(
      userId,
      this.dates.today(),
    );
    const membershipFeatures = membership
      ? await this.repository.listPlanFeatures(membership.planId)
      : [];
    const explicit = await this.repository.listUserEntitlements(
      userId,
      new Date(),
    );
    const accesses = [
      ...membershipFeatures.map((feature) => ({
        code: feature.code,
        name: feature.name,
        description: feature.description,
        source: "MEMBERSHIP" as const,
        sourceId: membership!.id,
        startsAt: membership!.startsOn,
        endsAt: membership!.endsOn,
      })),
      ...explicit.map(({ grant, feature }) => ({
        code: feature.code,
        name: feature.name,
        description: feature.description,
        source: grant.sourceType,
        sourceId: grant.sourceId,
        startsAt: grant.startsAt,
        endsAt: grant.endsAt,
      })),
    ];
    return [...new Map(accesses.map((item) => [item.code, item])).values()];
  }

  async getMyOptions(userId: string) {
    const membership = await this.repository.findLatestMembership(userId);
    const status = membership ? this.effectiveStatus(membership) : null;
    const plans = (await this.repository.listStorePlans()).filter((plan) => {
      if (!status || ["EXPIRED", "CANCELLED", "SUSPENDED"].includes(status))
        return plan.availableNew || plan.availableRenewal;
      return plan.availableExtension && membership?.planId === plan.id;
    });
    return { membershipStatus: status, plans: plans.map(mapPlan) };
  }

  createRenewalIntent(
    userId: string,
    input: MembershipIntentInput,
    correlationId?: string,
  ) {
    return this.createIntent(userId, input, "RENEWAL", correlationId);
  }

  createExtensionIntent(
    userId: string,
    input: MembershipIntentInput,
    correlationId?: string,
  ) {
    return this.createIntent(userId, input, "EXTENSION", correlationId);
  }

  async confirmIntent(intentId: string, actorUserId: string) {
    return this.sequelize.transaction(async (transaction) => {
      const intent = await this.repository.findIntent(intentId, transaction);
      if (!intent)
        throw new NotFoundException("Intención de membresía no encontrada.");
      if (intent.status === "CONFIRMED")
        return {
          intentId: intent.id,
          status: intent.status,
          membershipId: intent.membershipId,
        };
      if (intent.status !== "PENDING_PAYMENT")
        throw new ConflictException("La intención ya no está pendiente.");
      const plan = await this.repository.findStorePlan(
        intent.planId,
        transaction,
      );
      if (!plan)
        throw new UnprocessableEntityException(
          "El plan ya no está disponible.",
        );
      let membership = await this.repository.findLatestMembership(
        intent.userId,
        transaction,
      );
      const addedDays = plan.durationDays * intent.months;
      if (!membership) {
        const startsOn = this.dates.today();
        membership = await this.repository.createMembership(
          {
            userId: intent.userId,
            planId: plan.id,
            startsOn,
            endsOn: this.dates.addDays(startsOn, addedDays - 1),
            status: MembershipStatus.ACTIVE,
            externalReference: null,
            notes: null,
            createdByUserId: actorUserId,
            metadata: { intentId: intent.id },
          },
          transaction,
        );
      } else {
        const previousEndsOn = membership.endsOn;
        const baseDate =
          previousEndsOn >= this.dates.today()
            ? previousEndsOn
            : this.dates.today();
        const newEndsOn = this.dates.addDays(baseDate, addedDays);
        await this.repository.updateMembership(
          membership,
          {
            endsOn: newEndsOn,
            status: MembershipStatus.ACTIVE,
            cancelledAt: null,
            suspendedAt: null,
          },
          transaction,
        );
        await this.repository.createExtension(
          {
            membershipId: membership.id,
            intentId: intent.id,
            previousEndsOn,
            newEndsOn,
            addedDays,
            createdByUserId: actorUserId,
          },
          transaction,
        );
      }
      await intent.update(
        {
          status: "CONFIRMED",
          membershipId: membership.id,
          confirmedAt: new Date(),
        },
        { transaction },
      );
      return {
        intentId: intent.id,
        status: intent.status,
        membershipId: membership.id,
      };
    });
  }

  private async createIntent(
    userId: string,
    input: MembershipIntentInput,
    type: "RENEWAL" | "EXTENSION",
    correlationId: string = randomUUID(),
  ) {
    const result = await this.sequelize.transaction(async (transaction) => {
      const existing = await this.repository.findIntentByKey(
        userId,
        input.idempotencyKey,
        transaction,
      );
      if (existing) return existing;
      const [plan, membership] = await Promise.all([
        this.repository.findStorePlan(input.planId, transaction),
        this.repository.findLatestMembership(userId, transaction),
      ]);
      if (!plan)
        throw new NotFoundException("Plan no encontrado o no disponible.");
      if (
        type === "EXTENSION" &&
        (!membership ||
          this.effectiveStatus(membership) !== "ACTIVE" ||
          membership.planId !== plan.id)
      )
        throw new UnprocessableEntityException(
          "La extensión requiere una membresía activa del mismo plan.",
        );
      return this.repository.createIntent(
        {
          userId,
          membershipId: membership?.id ?? null,
          planId: plan.id,
          intentType: type,
          months: input.months,
          status: "PENDING_PAYMENT",
          channel: "WHATSAPP",
          idempotencyKey: input.idempotencyKey,
          correlationId,
        },
        transaction,
      );
    });
    const message = MEMBERSHIP_RENEWAL_MESSAGE;
    this.logger.log({
      event: "membership.whatsapp_renewal_started",
      userId,
      membershipId: result.membershipId,
      previousPlanId: result.planId,
      membershipStatus: result.status,
      correlationId: result.correlationId,
      timestamp: new Date().toISOString(),
    });
    return {
      id: result.id,
      publicId: result.publicId,
      status: result.status,
      type: result.intentType,
      membershipId: result.membershipId,
      planId: result.planId,
      months: result.months,
      whatsappUrl: buildMembershipWhatsAppUrl(env.WHATSAPP_MEMBERSHIP_PHONE),
      message,
      correlationId: result.correlationId,
      accessGranted: false,
    };
  }

  private effectiveStatus(
    membership: Awaited<
      ReturnType<MembershipRepository["findLatestMembership"]>
    > extends infer T
      ? NonNullable<T>
      : never,
  ): string {
    return membership.status === MembershipStatus.ACTIVE &&
      membership.endsOn < this.dates.today()
      ? MembershipStatus.EXPIRED
      : membership.status;
  }

  private mapEffectiveMembership(
    membership: NonNullable<
      Awaited<ReturnType<MembershipRepository["findLatestMembership"]>>
    >,
  ) {
    return {
      ...mapMembership(membership, this.dates),
      estado: this.effectiveStatus(membership),
    };
  }

  private renewalActions(status: string) {
    return ["EXPIRED", "CANCELLED", "SUSPENDED"].includes(status)
      ? [
          {
            type: "WHATSAPP",
            label: "Renovar por WhatsApp",
            phone: env.WHATSAPP_MEMBERSHIP_PHONE,
            message: "Hola, quisiera renovar mi membresía",
          },
        ]
      : [];
  }

  async listMemberships(filters: MembershipListInput) {
    const result = await this.repository.listMemberships(filters);
    return {
      items: result.rows.map((item) => mapMembership(item, this.dates)),
      page: filters.page,
      pageSize: filters.pageSize,
      total: result.count,
      totalPages: Math.ceil(result.count / filters.pageSize),
    };
  }

  private async validateScopes(
    scopes: { branchId: string; roomId: string | null }[],
  ) {
    for (const scope of scopes) {
      const branch = await this.facilitiesRepository.findBranch(scope.branchId);
      if (!branch) {
        throw new UnprocessableEntityException(
          "Una sede del alcance no existe.",
        );
      }
      if (!scope.roomId) continue;
      const room = await this.facilitiesRepository.findRoom(scope.roomId);
      if (!room || room.branchId !== scope.branchId) {
        throw new UnprocessableEntityException(
          "Una sala no pertenece a su sede.",
        );
      }
    }
  }

  private requirePlan(
    value: Awaited<ReturnType<MembershipRepository["findPlan"]>>,
  ) {
    if (!value) throw new NotFoundException("Plan no encontrado.");
    return value;
  }

  private requireMembership(
    value: Awaited<ReturnType<MembershipRepository["findMembership"]>>,
  ) {
    if (!value) throw new NotFoundException("Membresía no encontrada.");
    return value;
  }
}
