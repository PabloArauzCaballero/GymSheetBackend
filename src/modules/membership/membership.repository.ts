import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import {
  MembershipStatus,
  PlanStatus,
} from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';
import { CustomerProfileModel } from './customer-profile.model';
import { MembershipPlanModel } from './membership-plan.model';
import { MembershipStatusHistoryModel } from './membership-status-history.model';
import { MembershipModel } from './membership.model';
import { PlanAccessScopeModel } from './plan-access-scope.model';
import { StaffBranchScopeModel } from './staff-branch-scope.model';
import { StaffProfileModel } from './staff-profile.model';
import {
  CreatePlanInput,
  CreateStaffInput,
  MembershipListInput,
  UpdatePlanInput,
} from './membership.schemas';

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
  ) {}

  listPlans() {
    return this.plans.findAll({
      include: [PlanAccessScopeModel],
      order: [['name', 'ASC']],
    });
  }

  findPlan(planId: string, transaction?: Transaction) {
    return this.plans.findByPk(planId, {
      include: [PlanAccessScopeModel],
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
  }

  createPlan(
    input: Omit<CreatePlanInput, 'scopes'>,
    transaction: Transaction,
  ) {
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
      order: [['customerNumber', 'ASC']],
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
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
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
      order: [['endsOn', 'DESC']],
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
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
      order: [['endsOn', 'DESC']],
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
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
  }

  createStaff(
    input: Omit<CreateStaffInput, 'branchIds'>,
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
