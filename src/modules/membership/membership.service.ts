import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { EmploymentStatus, MembershipStatus, PlanStatus, UserRole } from '../../common/enums/domain.enums';
import { BusinessDateService } from '../../common/time/business-date.service';
import { env } from '../../config/env';
import { FacilitiesRepository } from '../facilities/facilities.repository';
import { UsersRepository } from '../users/users.repository';
import { mapCustomer, mapMembership, mapPlan, mapStaff } from './membership.mapper';
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
    private readonly dates: BusinessDateService,
    private readonly sequelize: Sequelize,
  ) {}

  async listPlans() { return (await this.repository.listPlans()).map(mapPlan); }

  async createPlan(input: CreatePlanInput) {
    await this.validateScopes(input.scopes);
    const plan = await this.sequelize.transaction(async (transaction) => {
      const { scopes, ...attributes } = input;
      const created = await this.repository.createPlan(attributes, transaction);
      await this.repository.replacePlanScopes(created.id, scopes, transaction);
      return created.id;
    });
    return mapPlan(this.requirePlan(await this.repository.findPlan(plan)));
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
      await this.repository.replacePlanScopes(planId, input.scopes, transaction);
    });
    return mapPlan(this.requirePlan(await this.repository.findPlan(planId)));
  }

  async createCustomer(input: CreateCustomerInput) {
    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_SALT_ROUNDS);
    try {
      const userId = await this.sequelize.transaction(async (transaction) => {
        if (await this.usersRepository.findByEmail(input.email, transaction)) throw new ConflictException('Ya existe una cuenta con este correo.');
        const user = await this.usersRepository.createClient({ email: input.email, passwordHash, fullName: input.fullName }, transaction);
        await this.repository.createCustomer({ userId: user.id, customerNumber: input.customerNumber, phoneNumber: input.phoneNumber, externalReference: input.externalReference, notes: input.notes, metadata: input.metadata }, transaction);
        return user.id;
      });
      return mapCustomer(this.requireCustomer(await this.repository.findCustomerByUserId(userId)));
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) throw new ConflictException('El correo, número de cliente o referencia externa ya existe.');
      throw error;
    }
  }

  async listCustomers(page: number, pageSize: number) {
    const result = await this.repository.listCustomers(page, pageSize);
    return { items: result.rows.map(mapCustomer), page, pageSize, total: result.count, totalPages: Math.ceil(result.count / pageSize) };
  }

  async createMembership(input: CreateMembershipInput, actorUserId: string) {
    const membershipId = await this.sequelize.transaction(async (transaction) => {
      const user = await this.usersRepository.findById(input.userId, transaction);
      const plan = await this.repository.findPlan(input.planId, transaction);
      if (!user || user.role !== UserRole.CLIENT) throw new UnprocessableEntityException('El cliente no existe o no tiene rol de cliente.');
      if (!plan || plan.status !== PlanStatus.ACTIVE) throw new UnprocessableEntityException('El plan no existe o está inactivo.');
      const startsOn = input.startsOn ?? this.dates.today();
      const endsOn = this.dates.addDays(startsOn, plan.durationDays - 1);
      const membership = await this.repository.createMembership({ ...input, startsOn, endsOn, createdByUserId: actorUserId, status: MembershipStatus.ACTIVE }, transaction);
      return membership.id;
    });
    return mapMembership(this.requireMembership(await this.repository.findMembership(membershipId)), this.dates);
  }

  async changeMembershipStatus(id: string, input: MembershipStatusInput) {
    const membership = await this.sequelize.transaction(async (transaction) => {
      const current = await this.repository.findMembership(id, transaction);
      if (!current) throw new NotFoundException('Membresía no encontrada.');
      if (current.status === MembershipStatus.CANCELLED && input.status !== MembershipStatus.CANCELLED) throw new ConflictException('Una membresía cancelada no puede reactivarse.');
      return this.repository.updateMembership(current, {
        status: input.status,
        notes: input.reason ? [current.notes, input.reason].filter(Boolean).join('\n') : current.notes,
        suspendedAt: input.status === MembershipStatus.SUSPENDED ? new Date() : null,
        cancelledAt: input.status === MembershipStatus.CANCELLED ? new Date() : current.cancelledAt,
      }, transaction);
    });
    return mapMembership(membership, this.dates);
  }

  async getMyMembership(userId: string) {
    const membership = await this.repository.findCurrentMembership(userId, this.dates.today());
    if (!membership) throw new NotFoundException('No existe una membresía vigente.');
    return mapMembership(membership, this.dates);
  }

  async listMemberships(filters: MembershipListInput) {
    const result = await this.repository.listMemberships(filters);
    return { items: result.rows.map((item) => mapMembership(item, this.dates)), page: filters.page, pageSize: filters.pageSize, total: result.count, totalPages: Math.ceil(result.count / filters.pageSize) };
  }

  async createStaff(input: CreateStaffInput) {
    await this.validateBranchIds(input.branchIds);
    const profileId = await this.sequelize.transaction(async (transaction) => {
      const user = await this.usersRepository.findById(input.userId, transaction);
      if (!user || ![UserRole.ADMIN, UserRole.COACH, UserRole.FRONT_DESK].includes(user.role)) throw new UnprocessableEntityException('El usuario no tiene un rol laboral permitido.');
      if (await this.repository.findStaffByUserId(input.userId, transaction)) throw new ConflictException('El usuario ya tiene un perfil laboral.');
      const { branchIds, ...attributes } = input;
      const profile = await this.repository.createStaff(attributes, transaction);
      await this.repository.replaceStaffScopes(profile.id, branchIds, transaction);
      return profile.id;
    });
    return mapStaff(this.requireStaff(await this.repository.findStaffByUserId(input.userId)));
  }

  async updateStaffStatus(userId: string, input: UpdateStaffStatusInput) {
    const profile = await this.repository.findStaffByUserId(userId);
    if (!profile) throw new NotFoundException('Perfil laboral no encontrado.');
    if (input.employmentStatus === EmploymentStatus.TERMINATED && !input.terminatedOn) throw new UnprocessableEntityException('La fecha de terminación es obligatoria.');
    await profile.update(input);
    return mapStaff(profile);
  }

  private async validateScopes(scopes: { branchId: string; roomId: string | null }[]) {
    for (const scope of scopes) {
      const branch = await this.facilitiesRepository.findBranch(scope.branchId);
      if (!branch) throw new UnprocessableEntityException('Una sede del alcance no existe.');
      if (scope.roomId) {
        const room = await this.facilitiesRepository.findRoom(scope.roomId);
        if (!room || room.branchId !== scope.branchId) throw new UnprocessableEntityException('Una sala no pertenece a su sede.');
      }
    }
  }

  private async validateBranchIds(branchIds: string[]) {
    for (const branchId of branchIds) if (!(await this.facilitiesRepository.findBranch(branchId))) throw new UnprocessableEntityException('Una sede asignada no existe.');
  }

  private requirePlan(value: Awaited<ReturnType<MembershipRepository['findPlan']>>) { if (!value) throw new NotFoundException('Plan no encontrado.'); return value; }
  private requireMembership(value: Awaited<ReturnType<MembershipRepository['findMembership']>>) { if (!value) throw new NotFoundException('Membresía no encontrada.'); return value; }
  private requireCustomer(value: Awaited<ReturnType<MembershipRepository['findCustomerByUserId']>>) { if (!value) throw new NotFoundException('Cliente no encontrado.'); return value; }
  private requireStaff(value: Awaited<ReturnType<MembershipRepository['findStaffByUserId']>>) { if (!value) throw new NotFoundException('Perfil laboral no encontrado.'); return value; }
}
