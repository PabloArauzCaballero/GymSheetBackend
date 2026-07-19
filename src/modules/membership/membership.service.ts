import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import {
  MembershipStatus,
  PlanStatus,
  UserRole,
} from '../../common/enums/domain.enums';
import { BusinessDateService } from '../../common/time/business-date.service';
import { FacilitiesRepository } from '../facilities/facilities.repository';
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

  createCustomer(input: CreateCustomerInput) {
    return this.customerStaff.createCustomer(input);
  }

  listCustomers(page: number, pageSize: number) {
    return this.customerStaff.listCustomers(page, pageSize);
  }

  createStaff(input: CreateStaffInput) {
    return this.customerStaff.createStaff(input);
  }

  updateStaffStatus(userId: string, input: UpdateStaffStatusInput) {
    return this.customerStaff.updateStaffStatus(userId, input);
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
      return membership.id;
    });

    return mapMembership(
      this.requireMembership(
        await this.repository.findMembership(membershipId),
      ),
      this.dates,
    );
  }

  async changeMembershipStatus(id: string, input: MembershipStatusInput) {
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
      return this.repository.updateMembership(
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
