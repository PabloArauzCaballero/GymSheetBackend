import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import { UserModel } from '../users/user.model';
import { DirectoryEntityModel } from './directory-entity.model';
import { EntityPaymentConfigModel } from './models/entity-payment-config.model';
import { EntityPlanModel } from './models/entity-plan.model';
import { PaymentOrderModel, PaymentOrderStatus } from './models/payment-order.model';
import { PlanPriceHistoryModel } from './models/plan-price-history.model';

@Injectable()
export class DirectoryPaymentsRepository {
  constructor(
    @InjectModel(DirectoryEntityModel)
    private readonly entityModel: typeof DirectoryEntityModel,
    @InjectModel(EntityPaymentConfigModel)
    private readonly paymentConfigModel: typeof EntityPaymentConfigModel,
    @InjectModel(EntityPlanModel)
    private readonly planModel: typeof EntityPlanModel,
    @InjectModel(PlanPriceHistoryModel)
    private readonly priceHistoryModel: typeof PlanPriceHistoryModel,
    @InjectModel(PaymentOrderModel)
    private readonly orderModel: typeof PaymentOrderModel,
  ) {}

  // --- ENTIDAD PADRE ---
  async findEntityById(entityId: string, transaction?: Transaction): Promise<DirectoryEntityModel | null> {
    return this.entityModel.findByPk(entityId, { transaction });
  }

  // --- CONFIGURACIÓN DE PAGO / QR ---
  async findPaymentConfig(entityId: string, transaction?: Transaction): Promise<EntityPaymentConfigModel | null> {
    return this.paymentConfigModel.findOne({ where: { entityId }, transaction });
  }

  async upsertPaymentConfig(
    entityId: string,
    data: {
      bankName: string;
      accountHolderName: string;
      taxId: string;
      accountNumber: string;
      aliasOrPhone?: string | null;
      qrImageUrl: string;
      qrPayload?: string | null;
      instructions?: string | null;
      isActive: boolean;
    },
    transaction?: Transaction,
  ): Promise<EntityPaymentConfigModel> {
    const existing = await this.findPaymentConfig(entityId, transaction);
    if (existing) {
      return existing.update(data, { transaction });
    }
    return this.paymentConfigModel.create({ entityId, ...data }, { transaction });
  }

  // --- PLANES Y MARKETPLACE ---
  async findPlanById(planId: string, transaction?: Transaction): Promise<EntityPlanModel | null> {
    return this.planModel.findByPk(planId, {
      include: [{ model: DirectoryEntityModel }],
      transaction,
    });
  }

  async findPlanBySlug(entityId: string, slug: string, transaction?: Transaction): Promise<EntityPlanModel | null> {
    return this.planModel.findOne({ where: { entityId, slug }, transaction });
  }

  async listPlans(entityId: string, onlyActive = true, transaction?: Transaction): Promise<EntityPlanModel[]> {
    const where: Record<string, unknown> = { entityId };
    if (onlyActive) {
      where.status = 'ACTIVE';
    }
    return this.planModel.findAll({
      where,
      order: [['displayOrder', 'ASC'], ['createdAt', 'DESC']],
      transaction,
    });
  }

  async createPlan(data: Partial<EntityPlanModel>, transaction?: Transaction): Promise<EntityPlanModel> {
    return this.planModel.create(data as any, { transaction });
  }

  async updatePlan(plan: EntityPlanModel, data: Partial<EntityPlanModel>, transaction?: Transaction): Promise<EntityPlanModel> {
    return plan.update(data, { transaction });
  }

  // --- HISTÓRICO DE PRECIOS (AUDITORÍA & PROTECCIÓN AL CONSUMIDOR) ---
  async createPriceHistory(
    data: {
      planId: string;
      price: string;
      currency: string;
      effectiveFrom: Date;
      effectiveTo?: Date | null;
      changedByUserId: string;
      changeReason: string;
      isPromotional?: boolean;
    },
    transaction?: Transaction,
  ): Promise<PlanPriceHistoryModel> {
    return this.priceHistoryModel.create(data as any, { transaction });
  }

  async findCurrentPriceHistory(planId: string, transaction?: Transaction): Promise<PlanPriceHistoryModel | null> {
    return this.priceHistoryModel.findOne({
      where: { planId, effectiveTo: null },
      order: [['effectiveFrom', 'DESC']],
      transaction,
    });
  }

  async closePriceHistory(priceHistoryId: string, effectiveTo: Date, transaction?: Transaction): Promise<void> {
    await this.priceHistoryModel.update(
      { effectiveTo },
      { where: { id: priceHistoryId }, transaction },
    );
  }

  async listPriceHistory(planId: string, transaction?: Transaction): Promise<PlanPriceHistoryModel[]> {
    return this.priceHistoryModel.findAll({
      where: { planId },
      include: [{ model: UserModel, as: 'changedByUser', attributes: ['id', 'email', 'fullName'] }],
      order: [['effectiveFrom', 'DESC']],
      transaction,
    });
  }

  // --- ÓRDENES DE PAGO Y COMPROBANTES ---
  async createOrder(data: Partial<PaymentOrderModel>, transaction?: Transaction): Promise<PaymentOrderModel> {
    return this.orderModel.create(data as any, { transaction });
  }

  async findOrderById(orderId: string, transaction?: Transaction): Promise<PaymentOrderModel | null> {
    return this.orderModel.findByPk(orderId, {
      include: [
        { model: DirectoryEntityModel },
        { model: EntityPlanModel },
        { model: UserModel, as: 'athlete', attributes: ['id', 'email', 'fullName'] },
        { model: UserModel, as: 'verifiedBy', attributes: ['id', 'email', 'fullName'] },
      ],
      transaction,
    });
  }

  async listOrdersForEntity(
    entityId: string,
    filter: { status?: PaymentOrderStatus; limit: number; offset: number },
    transaction?: Transaction,
  ): Promise<{ rows: PaymentOrderModel[]; count: number }> {
    const where: Record<string, unknown> = { entityId };
    if (filter.status) {
      where.status = filter.status;
    }
    return this.orderModel.findAndCountAll({
      where,
      include: [
        { model: EntityPlanModel, attributes: ['id', 'name', 'type', 'durationDays'] },
        { model: UserModel, as: 'athlete', attributes: ['id', 'email', 'fullName'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: filter.limit,
      offset: filter.offset,
      transaction,
    });
  }

  async listOrdersForAthlete(
    athleteUserId: string,
    filter: { status?: PaymentOrderStatus; limit: number; offset: number },
    transaction?: Transaction,
  ): Promise<{ rows: PaymentOrderModel[]; count: number }> {
    const where: Record<string, unknown> = { athleteUserId };
    if (filter.status) {
      where.status = filter.status;
    }
    return this.orderModel.findAndCountAll({
      where,
      include: [
        { model: DirectoryEntityModel, attributes: ['id', 'name', 'slug', 'logoUrl'] },
        { model: EntityPlanModel, attributes: ['id', 'name', 'type', 'durationDays'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: filter.limit,
      offset: filter.offset,
      transaction,
    });
  }

  async updateOrder(
    order: PaymentOrderModel,
    data: Partial<PaymentOrderModel>,
    transaction?: Transaction,
  ): Promise<PaymentOrderModel> {
    return order.update(data, { transaction });
  }
}
