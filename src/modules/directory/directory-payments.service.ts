import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import type { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { NotificationChannel, PlanStatus, PlanType, UserRole } from '../../common/enums/domain.enums';
import { ProductEvents } from '../../common/tracking/product-events';
import { MembershipPlanModel } from '../membership/membership-plan.model';
import { PlanAccessScopeModel } from '../membership/plan-access-scope.model';
import { MembershipService } from '../membership/membership.service';
import { NotificationService } from '../notifications/notification.service';
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
import { mapDirectoryEntitySummary } from './directory.mapper';

@Injectable()
export class DirectoryPaymentsService {
  constructor(
    private readonly repository: DirectoryPaymentsRepository,
    private readonly sequelize: Sequelize,
    @InjectModel(MembershipPlanModel)
    private readonly membershipPlanModel: typeof MembershipPlanModel,
    @InjectModel(PlanAccessScopeModel)
    private readonly planAccessScopeModel: typeof PlanAccessScopeModel,
    @Optional()
    private readonly membershipService?: MembershipService,
    @Optional()
    private readonly notificationService?: NotificationService,
    @Optional()
    private readonly productEvents?: ProductEvents,
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

  /**
   * Quién administra un ente del directorio: su dueño, un administrador de su
   * gimnasio o un administrador del sistema. Un socio del mismo gimnasio NO.
   */
  private canManageEntity(
    actor: AuthenticatedUser,
    entityUserId: string | null | undefined,
    entityTenantId: string | null | undefined,
  ): boolean {
    if (actor.role === UserRole.SYSTEM_ADMIN) return true;
    if (entityUserId && entityUserId === actor.id) return true;
    return Boolean(entityTenantId && actor.tenantId === entityTenantId && actor.role === UserRole.ADMIN);
  }

  /** Acceso ajeno → 404, no 403: no se confirma que el recurso existe. */
  private assertEntityOwnership(
    actor: AuthenticatedUser,
    entityUserId: string | null | undefined,
    entityTenantId: string | null | undefined,
    notFoundMessage = 'Entidad del directorio no encontrada.',
  ) {
    if (!this.canManageEntity(actor, entityUserId, entityTenantId)) {
      throw new NotFoundException(notFoundMessage);
    }
  }

  /**
   * Un aviso que falla no debe tumbar el pago. Dentro de una transacción de
   * PostgreSQL un error la deja abortada aunque se capture, así que el aviso va
   * en su propio punto de guardado: si falla, solo se deshace el aviso.
   */
  private async notifySafely(
    transaction: Transaction,
    message: Parameters<NotificationService['enqueueDirectMessage']>[0],
  ): Promise<void> {
    const notifications = this.notificationService;
    if (!notifications) return;
    try {
      await this.sequelize.transaction({ transaction }, (savepoint) =>
        notifications.enqueueDirectMessage(message, savepoint),
      );
    } catch {
      // El aviso se pierde; el pago sigue adelante. El evento de producto queda.
    }
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

  async listAllMarketplacePlans(type?: string, limit = 50) {
    const plans = await this.repository.listAllMarketplacePlans(type, limit);
    return plans.map((plan) => ({
      id: plan.id,
      entityId: plan.entityId,
      type: plan.type,
      name: plan.name,
      slug: plan.slug,
      description: plan.description,
      benefits: plan.benefits ?? [],
      durationDays: plan.durationDays,
      currentPrice: plan.currentPrice,
      currency: plan.currency,
      status: plan.status,
      displayOrder: plan.displayOrder,
      mediaUrls: plan.mediaUrls ?? [],
      // Los metadatos internos del comercio no salen en el listado público.
      metadata: {},
      entity: plan.entity ? mapDirectoryEntitySummary(plan.entity) : undefined,
    }));
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

      // 4. Si el comercio es un gimnasio con planes internos, sincronizar tarifa en membership.plans
      if (plan.entity?.tenantId && this.membershipPlanModel) {
        const planSlug = plan.slug;
        const planCode = `dir_${plan.entity.tenantId}_${planSlug}`.slice(0, 80);
        await this.membershipPlanModel.update(
          { priceAmount: newPriceStr, currency },
          { where: { code: planCode }, transaction }
        );
      }

      return { plan, newPriceHistory };
    });
  }

  async getPriceHistory(actor: AuthenticatedUser, planId: string): Promise<PlanPriceHistoryModel[]> {
    const plan = await this.repository.findPlanById(planId);
    if (!plan) throw new NotFoundException('Plan o producto no encontrado.');
    this.assertEntityOwnership(actor, plan.entity?.userId, plan.entity?.tenantId, 'Plan o producto no encontrado.');
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

    this.productEvents?.emit('directory_order_created', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      entityId: plan.entityId,
      planId: plan.id,
      athleteUserId: athlete.id,
      amount: Number(plan.currentPrice) || 0,
    });

    return { order, paymentConfig };
  }

  async submitReceipt(
    athlete: AuthenticatedUser,
    orderId: string,
    input: SubmitReceiptInput,
  ): Promise<PaymentOrderModel> {
    const order = await this.repository.findOrderById(orderId);
    // Una orden ajena se responde igual que una inexistente.
    if (!order || order.athleteUserId !== athlete.id) {
      throw new NotFoundException('Orden de pago no encontrada.');
    }

    const updatedOrder = await this.sequelize.transaction(async (transaction) => {
      const locked = await this.repository.lockOrder(order.id, transaction);
      if (!locked) throw new NotFoundException('Orden de pago no encontrada.');
      if (locked.status !== 'PENDING_PAYMENT' && locked.status !== 'REJECTED') {
        throw new BadRequestException(`No es posible subir comprobante en una orden con estado ${locked.status}.`);
      }
      const updated = await this.repository.updateOrder(
        locked,
        {
          receiptUrl: input.receiptUrl,
          receiptStorageKey: input.receiptStorageKey ?? null,
          receiptReference: input.receiptReference ?? null,
          athleteNotes: input.athleteNotes ?? locked.athleteNotes,
          submittedAt: new Date(),
          status: 'PENDING_VERIFICATION',
          rejectionReason: null,
        },
        transaction,
      );

      // Avisar al dueño del comercio.
      if (order.entity?.userId) {
        await this.notifySafely(transaction, {
          recipientUserId: order.entity.userId,
          channel: NotificationChannel.IN_APP,
          subject: `Comprobante de pago recibido - ${order.orderNumber}`,
          body: `Un atleta ha subido su comprobante para "${order.plan?.name ?? 'Plan'}" (${order.amount} ${order.currency}). Revisa y confirma la orden para activar el acceso.`,
          deduplicationKey: `payment_receipt_submitted:${order.id}:${Date.now()}`,
        });
      }
      return updated;
    });

    this.productEvents?.emit('directory_order_receipt_submitted', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      entityId: order.entityId,
      athleteUserId: athlete.id,
    });

    return updatedOrder;
  }

  async getOrderById(actor: AuthenticatedUser, orderId: string): Promise<PaymentOrderModel> {
    const order = await this.repository.findOrderById(orderId);
    if (!order) throw new NotFoundException('Orden de pago no encontrada.');

    // Solo el atleta dueño o quien administra el ente. Antes bastaba con ser
    // del mismo gimnasio: cualquier socio podía leer el comprobante de otro.
    const isAthlete = order.athleteUserId === actor.id;
    const isEntityStaff = this.canManageEntity(actor, order.entity?.userId, order.entity?.tenantId);
    if (!isAthlete && !isEntityStaff) {
      throw new NotFoundException('Orden de pago no encontrada.');
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
    this.assertEntityOwnership(actor, order.entity?.userId, order.entity?.tenantId, 'Orden de pago no encontrada.');

    /*
     * Todo en una sola transacción: la orden se bloquea (dos confirmaciones a la
     * vez no crean dos membresías) y la membresía se crea como punto de
     * guardado dentro de ella (si algo falla después, no queda una membresía
     * activa con la orden sin confirmar).
     */
    const { updatedOrder, createdMembershipId } = await this.sequelize.transaction(async (transaction) => {
      const locked = await this.repository.lockOrder(order.id, transaction);
      if (!locked) throw new NotFoundException('Orden de pago no encontrada.');
      if (locked.status !== 'PENDING_VERIFICATION') {
        throw new BadRequestException('Solo se pueden confirmar órdenes en estado PENDING_VERIFICATION con comprobante subido.');
      }

      let membershipId: string | null = null;
      // Si el comercio es un gimnasio y el plan es de membresía, se activa la membresía.
      if (order.entity?.tenantId && order.plan && this.membershipService) {
        const planSlug = order.plan.slug || this.slugify(order.plan.name);
        const planCode = `dir_${order.entity.tenantId}_${planSlug}`.slice(0, 80);

        let membershipPlan = await this.membershipPlanModel.findOne({ where: { code: planCode }, transaction });
        if (!membershipPlan) {
          membershipPlan = await this.membershipPlanModel.create(
            {
              code: planCode,
              name: order.plan.name,
              description: order.plan.description,
              planType: PlanType.CUSTOM,
              durationDays: order.plan.durationDays || 30,
              reminderDays: [7, 3, 1, 0],
              status: PlanStatus.ACTIVE,
              priceAmount: order.amount,
              currency: order.currency,
              benefits: order.plan.benefits ?? [],
              displayOrder: 0,
              availableNew: true,
              availableRenewal: true,
              availableExtension: true,
              metadata: { directoryPlanId: order.plan.id, entityId: order.entityId },
            },
            { transaction },
          );
          if (order.entity.branchId) {
            await this.planAccessScopeModel.create(
              { planId: membershipPlan.id, branchId: order.entity.branchId },
              { transaction },
            );
          }
        }

        const membership = await this.membershipService.createMembership(
          {
            userId: order.athleteUserId,
            planId: membershipPlan.id,
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
          transaction,
        );
        membershipId = membership.id;
      }

      const updated = await this.repository.updateOrder(
        locked,
        { status: 'CONFIRMED', verifiedByUserId: actor.id, verifiedAt: new Date(), membershipId },
        transaction,
      );

      await this.notifySafely(transaction, {
        recipientUserId: order.athleteUserId,
        channel: NotificationChannel.IN_APP,
        subject: '¡Pago confirmado! Tu plan ya está activo',
        body: `Tu pago de ${order.amount} ${order.currency} para "${order.plan?.name ?? 'Plan'}" en "${order.entity?.name ?? 'el comercio'}" fue verificado exitosamente. ¡Ya puedes disfrutar de tus beneficios!`,
        deduplicationKey: `payment_order_confirmed:${order.id}`,
      });

      return { updatedOrder: updated, createdMembershipId: membershipId };
    });

    // Fuera de la transacción: un evento de producto no debe contar un pago que no se confirmó.
    this.productEvents?.emit('directory_order_confirmed', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      entityId: order.entityId,
      planId: order.planId,
      athleteUserId: order.athleteUserId,
      membershipId: createdMembershipId,
    });

    return updatedOrder;
  }

  async rejectOrder(
    actor: AuthenticatedUser,
    orderId: string,
    input: RejectPaymentOrderInput,
  ): Promise<PaymentOrderModel> {
    const order = await this.repository.findOrderById(orderId);
    if (!order) throw new NotFoundException('Orden de pago no encontrada.');
    this.assertEntityOwnership(actor, order.entity?.userId, order.entity?.tenantId, 'Orden de pago no encontrada.');

    const updatedOrder = await this.sequelize.transaction(async (transaction) => {
      const locked = await this.repository.lockOrder(order.id, transaction);
      if (!locked) throw new NotFoundException('Orden de pago no encontrada.');
      if (locked.status !== 'PENDING_VERIFICATION') {
        throw new BadRequestException('Solo se pueden rechazar órdenes con comprobante en estado PENDING_VERIFICATION.');
      }
      const updated = await this.repository.updateOrder(
        locked,
        { status: 'REJECTED', verifiedByUserId: actor.id, verifiedAt: new Date(), rejectionReason: input.reason },
        transaction,
      );
      await this.notifySafely(transaction, {
        recipientUserId: order.athleteUserId,
        channel: NotificationChannel.IN_APP,
        subject: `Observación en tu comprobante de pago - Orden ${order.orderNumber}`,
        body: `El comercio ha observado tu comprobante para "${order.plan?.name ?? 'Plan'}": "${input.reason}". Puedes subir un nuevo comprobante corregido desde tu historial.`,
        deduplicationKey: `payment_order_rejected:${order.id}:${Date.now()}`,
      });
      return updated;
    });

    this.productEvents?.emit('directory_order_rejected', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      entityId: order.entityId,
      athleteUserId: order.athleteUserId,
      reason: input.reason,
    });

    return updatedOrder;
  }
}
