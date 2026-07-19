import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Sequelize } from 'sequelize-typescript';
import {
  MembershipStatus,
  PlanStatus,
  UserRole,
} from '../../common/enums/domain.enums';
import { BusinessDateService } from '../../common/time/business-date.service';
import { FacilitiesRepository } from '../facilities/facilities.repository';
import { GymDomainEvent } from '../integration/domain-event.catalog';
import { DomainEventPublisher } from '../integration/domain-event.publisher';
import { UsersRepository } from '../users/users.repository';
import { CustomerStaffService } from './customer-staff.service';
import { mapMembership, mapPlan } from './membership.mapper';
import { MembershipRepository } from './membership.repository';
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
} from './membership.schemas';

@Injectable()
export class MembershipService {
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
    if (!plan) throw new NotFoundException('Plan no encontrado.');
    return mapPlan(await this.repository.updatePlan(plan, input));
  }

  async replacePlanScopes(planId: string, input: ReplacePlanScopesInput) {
    await this.validateScopes(input.scopes);
    await this.sequelize.transaction(async (transaction) => {
      const plan = await this.repository.findPlan(planId, transaction);
      if (!plan) throw new NotFoundException('Plan no encontrado.');
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

  async createMembership(
    input: CreateMembershipInput,
    actorUserId: string,
  ) {
    const membershipId = await this.sequelize.transaction(async (transaction) => {
      const user = await this.usersRepository.findById(input.userId, transaction);
      const plan = await this.repository.findPlan(input.planId, transaction);

      if (!user || user.role !== UserRole.CLIENT) {
        throw new UnprocessableEntityException(
          'El cliente no existe o no tiene rol de cliente.',
        );
      }
      if (!plan || plan.status !== PlanStatus.ACTIVE) {
        throw new UnprocessableEntityException(
          'El plan no existe o está inactivo.',
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
          aggregateType: 'membership',
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
    });

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
        throw new NotFoundException('Membresía no encontrada.');
      }
      if (
        current.status === MembershipStatus.CANCELLED &&
        input.status !== MembershipStatus.CANCELLED
      ) {
        throw new ConflictException(
          'Una membresía cancelada no puede reactivarse.',
        );
      }
      if (current.status === input.status) return current;

      const fromStatus = current.status;
      const updated = await this.repository.updateMembership(
        current,
        {
          status: input.status,
          notes: input.reason
            ? [current.notes, input.reason].filter(Boolean).join('\n')
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
          aggregateType: 'membership',
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
      throw new NotFoundException('No existe una membresía vigente.');
    }
    return mapMembership(membership, this.dates);
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
          'Una sede del alcance no existe.',
        );
      }
      if (!scope.roomId) continue;
      const room = await this.facilitiesRepository.findRoom(scope.roomId);
      if (!room || room.branchId !== scope.branchId) {
        throw new UnprocessableEntityException(
          'Una sala no pertenece a su sede.',
        );
      }
    }
  }

  private requirePlan(
    value: Awaited<ReturnType<MembershipRepository['findPlan']>>,
  ) {
    if (!value) throw new NotFoundException('Plan no encontrado.');
    return value;
  }

  private requireMembership(
    value: Awaited<ReturnType<MembershipRepository['findMembership']>>,
  ) {
    if (!value) throw new NotFoundException('Membresía no encontrada.');
    return value;
  }
}
