import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { UserRole } from '../../common/enums/domain.enums';
import { MembershipService } from '../membership/membership.service';
import { DirectoryPaymentsRepository } from './directory-payments.repository';
import {
  CreateEntityPlanInput,
  CreatePaymentOrderInput,
  EntityPaymentConfigInput,
  PaymentOrderListQuery,
  RejectPaymentOrderInput,
  SubmitReceiptInput,
  UpdateEntityPlanInput,
  UpdatePlanPriceInput,
} from './directory-payments.schemas';
import { EntityPaymentConfigModel } from './models/entity-payment-config.model';
import { EntityPlanModel } from './models/entity-plan.model';
import { PaymentOrderModel } from './models/payment-order.model';
import { PlanPriceHistoryModel } from './models/plan-price-history.model';

@Injectable()
export class DirectoryPaymentsService {
  constructor(
    private readonly repository: DirectoryPaymentsRepository,
    private readonly sequelize: Sequelize,
    @Optional()
    private readonly membershipService?: MembershipService,
  ) {}

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private generateOrderNumber(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `GS-ORD-${timestamp}-${random}`;
  }

  private assertEntityOwnership(actor: AuthenticatedUser, entityUserId: string | null, entityTenantId: string | null) {
    if (actor.role === UserRole.SYSTEM_ADMIN) return;
    if (entityUserId && entityUserId === actor.id) return;
    if (entityTenantId && actor.tenantId === entityTenantId && actor.role === UserRole.ADMIN) return;
    throw new ForbiddenException('No tienes permisos de administración sobre este ente del directorio.');
  }

  // =========================================================================
  // 1. CONFIGURACIÓN DE PAGO BANCARIO Y QR
  // =========================================================================

  async getPaymentConfig(entityId: string): Promise<EntityPaymentConfigModel | null> {
    const entity = await this.repository.findEntityById(entityId);
    if (!entity) throw new NotFoundException('Entidad del directorio no encontrada.');
    return this.repository.findPaymentConfig(entityId);
  }

  async upsertPaymentConfig(
    actor: AuthenticatedUser,
    entityId: string,
    input: EntityPaymentConfigInput,
  ): Promise<EntityPaymentConfigModel> {
    const entity = await this.repository.findEntityById(entityId);
    if (!entity) throw new NotFoundException('Entidad del directorio no encontrada.');
    this.assertEntityOwnership(actor, entity.userId, entity.tenantId);

    return this.repository.upsertPaymentConfig(entityId, input);
  }

  // =========================================================================
  // 2. CATÁLOGO DE PLANES Y PRODUCTOS EN MARKETPLACE
  // =========================================================================

  async listPlans(entityId: string, onlyActive = true): Promise<EntityPlanModel[]> {
    const entity = await this.repository.findEntityById(entityId);
    if (!entity) throw new NotFoundException('Entidad del directorio no encontrada.');
    return this.repository.listPlans(entityId, onlyActive);
  }

  async getPlanById(planId: string): Promise<EntityPlanModel> {
    const plan = await this.repository.findPlanById(planId);
    if (!plan) throw new NotFoundException('Plan o producto no encontrado.');
    return plan;
  }

  async createPlan(
    actor: AuthenticatedUser,
    entityId: string,
    input: CreateEntityPlanInput,
  ): Promise<EntityPlanModel> {
    const entity = await this.repository.findEntityById(entityId);
    if (!entity) throw new NotFoundException('Entidad del directorio no encontrada.');
    this.assertEntityOwnership(actor, entity.userId, entity.tenantId);

    const slug = input.slug ? this.slugify(input.slug) : this.slugify(input.name);
    const existingSlug = await this.repository.findPlanBySlug(entityId, slug);
    if (existingSlug) {
      throw new ConflictException(`Ya existe un plan con el identificador "${slug}" en este comercio.`);
    }

    return this.sequelize.transaction(async (transaction) => {
      const plan = await this.repository.createPlan(
        {
          entityId,
          type: input.type ?? 'MEMBERSHIP_PLAN',
          name: input.name,
          slug,
          description: input.description,
          benefits: input.benefits ?? [],
          durationDays: input.durationDays ?? null,
          currentPrice: input.price.toFixed(2),
          currency: input.currency ?? 'USD',
          status: 'ACTIVE',
          displayOrder: input.displayOrder ?? 0,
          mediaUrls: input.mediaUrls ?? [],
          metadata: input.metadata ?? {},
        },
        transaction,
      );

      // Línea base inmutable en el historial de precios por auditoría
      await this.repository.createPriceHistory(
        {
          planId: plan.id,
          price: plan.currentPrice,
          currency: plan.currency,
          effectiveFrom: new Date(),
          effectiveTo: null,
          changedByUserId: actor.id,
          changeReason: input.initialReason ?? 'Precio de lanzamiento inicial',
          isPromotional: false,
        },
        transaction,
      );

      return plan;
    });
  }

  async updatePlan(
    actor: AuthenticatedUser,
    planId: string,
    input: UpdateEntityPlanInput,
  ): Promise<EntityPlanModel> {
    const plan = await this.repository.findPlanById(planId);
    if (!plan) throw new NotFoundException('Plan o producto no encontrado.');
    this.assertEntityOwnership(actor, plan.entity?.userId ?? null, plan.entity?.tenantId ?? null);

    return this.repository.updatePlan(plan, input);
  }

  // =========================================================================
  // 3. REDUNDANCIA CONTROLADA: HISTÓRICO DE PRECIOS POR AUDITORÍA
  // =========================================================================

  async updatePlanPrice(
    actor: AuthenticatedUser,
    planId: string,
    input: UpdatePlanPriceInput,
  ): Promise<{ plan: EntityPlanModel; newPriceHistory: PlanPriceHistoryModel }> {
    const plan = await this.repository.findPlanById(planId);
    if (!plan) throw new NotFoundException('Plan o producto no encontrado.');
    this.assertEntityOwnership(actor, plan.entity?.userId ?? null, plan.entity?.tenantId ?? null);

    const newPriceStr = input.newPrice.toFixed(2);
    if (plan.currentPrice === newPriceStr) {
      throw new BadRequestException('El nuevo precio debe ser diferente al precio actual.');
    }

    const currency = input.currency ?? plan.currency;
    const now = new Date();

    return this.sequelize.transaction(async (transaction) => {
      // 1. Cerrar vigencia del precio anterior
      const currentHistory = await this.repository.findCurrentPriceHistory(plan.id, transaction);
      if (currentHistory) {
        await this.repository.closePriceHistory(currentHistory.id, now, transaction);
      }

      // 2. Insertar nuevo precio inmutable en el historial
      const newPriceHistory = await this.repository.createPriceHistory(
        {
          planId: plan.id,
          price: newPriceStr,
          currency,
          effectiveFrom: now,
          effectiveTo: null,
          changedByUserId: actor.id,
          changeReason: input.reason,
          isPromotional: input.isPromotional ?? false,
        },
        transaction,
      );

      // 3. Actualizar precio vigente en el catálogo
      await this.repository.updatePlan(plan, { currentPrice: newPriceStr, currency }, transaction);

      return { plan, newPriceHistory };
    });
  }

  async getPriceHistory(actor: AuthenticatedUser, planId: string): Promise<PlanPriceHistoryModel[]> {
    const plan = await this.repository.findPlanById(planId);
    if (!plan) throw new NotFoundException('Plan o producto no encontrado.');
    return this.repository.listPriceHistory(planId);
  }

  // =========================================================================
  // 4. MÓDULO DE PAGOS MANUALES (QR + COMPROBANTE)
  // =========================================================================

  async createPaymentOrder(
    athlete: AuthenticatedUser,
    input: CreatePaymentOrderInput,
  ): Promise<{ order: PaymentOrderModel; paymentConfig: EntityPaymentConfigModel | null }> {
    const plan = await this.repository.findPlanById(input.planId);
    if (!plan) throw new NotFoundException('Plan no encontrado.');
    if (plan.status !== 'ACTIVE') throw new BadRequestException('Este plan no se encuentra activo para compra.');

    const currentPriceHistory = await this.repository.findCurrentPriceHistory(plan.id);
    if (!currentPriceHistory) {
      throw new BadRequestException('El plan no tiene una tarifa activa configurada.');
    }

    const paymentConfig = await this.repository.findPaymentConfig(plan.entityId);
    if (!paymentConfig || !paymentConfig.isActive) {
      throw new BadRequestException('El comercio no tiene habilitado un método de cobro QR activo actualmente.');
    }

    // Snapshot inmutable de las condiciones ofrecidas al atleta en este milisegundo exacto
    const planSnapshot = {
      id: plan.id,
      name: plan.name,
      type: plan.type,
      description: plan.description,
      benefits: plan.benefits,
      durationDays: plan.durationDays,
    };

    const orderNumber = this.generateOrderNumber();
    const order = await this.repository.createOrder({
      orderNumber,
      entityId: plan.entityId,
      planId: plan.id,
      athleteUserId: athlete.id,
      priceHistoryId: currentPriceHistory.id,
      amount: plan.currentPrice,
      currency: plan.currency,
      planSnapshot,
      status: 'PENDING_PAYMENT',
      athleteNotes: input.athleteNotes ?? null,
    });

    return { order, paymentConfig };
  }

  async submitReceipt(
    athlete: AuthenticatedUser,
    orderId: string,
    input: SubmitReceiptInput,
  ): Promise<PaymentOrderModel> {
    const order = await this.repository.findOrderById(orderId);
    if (!order) throw new NotFoundException('Orden de pago no encontrada.');
    if (order.athleteUserId !== athlete.id) {
      throw new ForbiddenException('Esta orden de pago no pertenece a tu usuario.');
    }
    if (order.status !== 'PENDING_PAYMENT' && order.status !== 'REJECTED') {
      throw new BadRequestException(`No es posible subir comprobante en una orden con estado ${order.status}.`);
    }

    return this.repository.updateOrder(order, {
      receiptUrl: input.receiptUrl,
      receiptStorageKey: input.receiptStorageKey ?? null,
      receiptReference: input.receiptReference ?? null,
      athleteNotes: input.athleteNotes ?? order.athleteNotes,
      submittedAt: new Date(),
      status: 'PENDING_VERIFICATION',
      rejectionReason: null,
    });
  }

  async getOrderById(actor: AuthenticatedUser, orderId: string): Promise<PaymentOrderModel> {
    const order = await this.repository.findOrderById(orderId);
    if (!order) throw new NotFoundException('Orden de pago no encontrada.');

    // Acceso permitido al atleta propietario o al administrador del ente
    const isAthlete = order.athleteUserId === actor.id;
    const isEntityStaff =
      actor.role === UserRole.SYSTEM_ADMIN ||
      (order.entity && (order.entity.userId === actor.id || (order.entity.tenantId && actor.tenantId === order.entity.tenantId)));

    if (!isAthlete && !isEntityStaff) {
      throw new ForbiddenException('No tienes autorización para ver esta orden de pago.');
    }

    return order;
  }

  async listOrdersForAthlete(
    athlete: AuthenticatedUser,
    query: PaymentOrderListQuery,
  ): Promise<{ items: PaymentOrderModel[]; total: number }> {
    const { rows, count } = await this.repository.listOrdersForAthlete(athlete.id, query);
    return { items: rows, total: count };
  }

  async listOrdersForEntity(
    actor: AuthenticatedUser,
    entityId: string,
    query: PaymentOrderListQuery,
  ): Promise<{ items: PaymentOrderModel[]; total: number }> {
    const entity = await this.repository.findEntityById(entityId);
    if (!entity) throw new NotFoundException('Entidad del directorio no encontrada.');
    this.assertEntityOwnership(actor, entity.userId, entity.tenantId);

    const { rows, count } = await this.repository.listOrdersForEntity(entityId, query);
    return { items: rows, total: count };
  }

  async confirmOrder(actor: AuthenticatedUser, orderId: string): Promise<PaymentOrderModel> {
    const order = await this.repository.findOrderById(orderId);
    if (!order) throw new NotFoundException('Orden de pago no encontrada.');
    this.assertEntityOwnership(actor, order.entity?.userId ?? null, order.entity?.tenantId ?? null);

    if (order.status !== 'PENDING_VERIFICATION') {
      throw new BadRequestException('Solo se pueden confirmar órdenes en estado PENDING_VERIFICATION con comprobante subido.');
    }

    return this.sequelize.transaction(async (transaction) => {
      let createdMembershipId: string | null = null;

      // Si el comercio está vinculado a un gimnasio y el plan es una membresía, activar en MembershipService
      if (order.entity?.tenantId && order.plan?.durationDays && this.membershipService) {
        try {
          const membership = await this.membershipService.createMembership(
            {
              userId: order.athleteUserId,
              planId: order.planId,
              startsOn: undefined, // hoy
              externalReference: order.orderNumber,
              notes: `Activación por pago QR verificado en Marketplace (Orden: ${order.orderNumber})`,
              metadata: {
                paymentOrderId: order.id,
                orderNumber: order.orderNumber,
                receiptUrl: order.receiptUrl,
                receiptReference: order.receiptReference,
              },
            },
            actor.id,
          );
          createdMembershipId = membership.id;
        } catch {
          // Si el planId del directorio no coincide con un plan de membership.plans interno, no se bloquea la orden
        }
      }

      return this.repository.updateOrder(
        order,
        {
          status: 'CONFIRMED',
          verifiedByUserId: actor.id,
          verifiedAt: new Date(),
          membershipId: createdMembershipId,
        },
        transaction,
      );
    });
  }

  async rejectOrder(
    actor: AuthenticatedUser,
    orderId: string,
    input: RejectPaymentOrderInput,
  ): Promise<PaymentOrderModel> {
    const order = await this.repository.findOrderById(orderId);
    if (!order) throw new NotFoundException('Orden de pago no encontrada.');
    this.assertEntityOwnership(actor, order.entity?.userId ?? null, order.entity?.tenantId ?? null);

    if (order.status !== 'PENDING_VERIFICATION') {
      throw new BadRequestException('Solo se pueden rechazar órdenes con comprobante en estado PENDING_VERIFICATION.');
    }

    return this.repository.updateOrder(order, {
      status: 'REJECTED',
      verifiedByUserId: actor.id,
      verifiedAt: new Date(),
      rejectionReason: input.reason,
    });
  }
}
