import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { PlanStatus, PlanType } from '../../common/enums/domain.enums';
import { DirectoryEntityModel } from '../directory/directory-entity.model';
import { EntityPlanModel } from '../directory/models/entity-plan.model';
import { PaymentOrderModel } from '../directory/models/payment-order.model';
import { MembershipPlanModel } from '../membership/membership-plan.model';
import { MembershipService } from '../membership/membership.service';
import { PlanAccessScopeModel } from '../membership/plan-access-scope.model';

/**
 * Legacy bridge kept until franja 8e (plan §5 8d.6): confirming an order of a
 * listing whose seller is a gym with a tenant creates the membership on the
 * mirror plan `dir_{tenant}_{slug}`, as the old directory console did. It runs
 * inside the confirmation's transaction: no membership without a confirmed
 * order, and two confirmations cannot create two (the order is row-locked).
 */
@Injectable()
export class OrderMembershipBridge {
  constructor(
    @InjectModel(DirectoryEntityModel) private readonly entities: typeof DirectoryEntityModel,
    @InjectModel(EntityPlanModel) private readonly listings: typeof EntityPlanModel,
    @InjectModel(MembershipPlanModel) private readonly membershipPlans: typeof MembershipPlanModel,
    @InjectModel(PlanAccessScopeModel) private readonly scopes: typeof PlanAccessScopeModel,
    @Optional() private readonly memberships?: MembershipService,
  ) {}

  async activate(order: PaymentOrderModel, actorUserId: string, transaction: Transaction): Promise<string | null> {
    if (!this.memberships) return null;
    const entity = await this.entities.findByPk(order.entityId, { transaction });
    const listing = await this.listings.findByPk(order.planId, { transaction });
    if (!entity?.tenantId || !listing) return null;
    const code = `dir_${entity.tenantId}_${listing.slug}`.slice(0, 80);
    let plan = await this.membershipPlans.findOne({ where: { code }, transaction });
    if (!plan) {
      plan = await this.membershipPlans.create(
        {
          code,
          name: listing.name,
          description: listing.description,
          planType: PlanType.CUSTOM,
          durationDays: listing.durationDays || 30,
          reminderDays: [7, 3, 1, 0],
          status: PlanStatus.ACTIVE,
          priceAmount: order.unitAmount,
          currency: order.currency,
          benefits: listing.benefits ?? [],
          displayOrder: 0,
          availableNew: true,
          availableRenewal: true,
          availableExtension: true,
          metadata: { directoryPlanId: listing.id, entityId: order.entityId },
        },
        { transaction },
      );
      if (entity.branchId) await this.scopes.create({ planId: plan.id, branchId: entity.branchId }, { transaction });
    }
    const membership = await this.memberships.createMembership(
      {
        userId: order.athleteUserId,
        planId: plan.id,
        startsOn: undefined,
        externalReference: order.orderNumber,
        notes: `Activación por pago verificado en el marketplace (pedido ${order.orderNumber})`,
        metadata: { paymentOrderId: order.id, orderNumber: order.orderNumber, receiptReference: order.receiptReference },
      },
      actorUserId,
      transaction,
    );
    return membership.id;
  }
}
