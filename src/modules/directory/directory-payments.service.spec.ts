import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../../common/enums/domain.enums';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { DirectoryPaymentsService } from './directory-payments.service';

describe('DirectoryPaymentsService - Marketplace, Histórico de Precios y Pagos Manuales', () => {
  let service: DirectoryPaymentsService;
  let mockRepo: any;
  let mockSequelize: any;
  let mockMembershipService: any;

  const mockAdminUser: AuthenticatedUser = {
    id: 'admin-user-1',
    email: 'admin@gym.com',
    role: UserRole.ADMIN,
    tenantId: 'tenant-gym-1',
    tenantScope: 'tenant-gym-1',
    impersonating: false,
  };

  const mockAthleteUser: AuthenticatedUser = {
    id: 'athlete-user-1',
    email: 'athlete@athlete.com',
    role: UserRole.CLIENT,
    tenantId: 'tenant-gym-1',
    tenantScope: null,
    impersonating: false,
  };

  const mockOtherUser: AuthenticatedUser = {
    id: 'other-user-99',
    email: 'other@athlete.com',
    role: UserRole.CLIENT,
    tenantId: 'tenant-gym-2',
    tenantScope: null,
    impersonating: false,
  };

  beforeEach(() => {
    mockSequelize = {
      transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => cb({})),
    };

    mockRepo = {
      findEntityById: jest.fn(),
      findPaymentConfig: jest.fn(),
      upsertPaymentConfig: jest.fn(),
      findPlanById: jest.fn(),
      findPlanBySlug: jest.fn(),
      listPlans: jest.fn(),
      createPlan: jest.fn(),
      updatePlan: jest.fn(),
      createPriceHistory: jest.fn(),
      findCurrentPriceHistory: jest.fn(),
      closePriceHistory: jest.fn(),
      listPriceHistory: jest.fn(),
      createOrder: jest.fn(),
      findOrderById: jest.fn(),
      listOrdersForAthlete: jest.fn(),
      listOrdersForEntity: jest.fn(),
      updateOrder: jest.fn(),
    };

    mockMembershipService = {
      createMembership: jest.fn(),
    };

    service = new DirectoryPaymentsService(mockRepo, mockSequelize, mockMembershipService);
  });

  describe('Marketplace: Creación de Planes e Histórico de Precios Inicial', () => {
    it('crea el plan en el marketplace y genera su primer registro en el historial de precios para auditoría', async () => {
      mockRepo.findEntityById.mockResolvedValue({
        id: 'entity-1',
        userId: 'admin-user-1',
        tenantId: 'tenant-gym-1',
      });
      mockRepo.findPlanBySlug.mockResolvedValue(null);

      const createdPlan = {
        id: 'plan-1',
        entityId: 'entity-1',
        name: 'Plan Mensual Pro',
        slug: 'plan-mensual-pro',
        currentPrice: '45.00',
        currency: 'USD',
      };
      mockRepo.createPlan.mockResolvedValue(createdPlan);
      mockRepo.createPriceHistory.mockResolvedValue({ id: 'price-hist-1' });

      const plan = await service.createPlan(mockAdminUser, 'entity-1', {
        name: 'Plan Mensual Pro',
        type: 'MEMBERSHIP_PLAN',
        description: 'Acceso total a musculación y cardio',
        benefits: ['Pase libre', 'Vestuarios'],
        durationDays: 30,
        price: 45,
        currency: 'USD',
        displayOrder: 1,
        mediaUrls: [],
        metadata: {},
        initialReason: 'Tarifa inicial de lanzamiento',
      });

      expect(plan.id).toBe('plan-1');
      expect(mockRepo.createPlan).toHaveBeenCalled();
      expect(mockRepo.createPriceHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: 'plan-1',
          price: '45.00',
          currency: 'USD',
          changedByUserId: mockAdminUser.id,
          changeReason: 'Tarifa inicial de lanzamiento',
          effectiveTo: null,
        }),
        expect.anything(),
      );
    });
  });

  describe('Redundancia Controlada: Modificación de Precios y Protección al Consumidor', () => {
    it('cierra el intervalo del precio anterior y abre uno nuevo registrando el motivo legal', async () => {
      const plan = {
        id: 'plan-1',
        entityId: 'entity-1',
        currentPrice: '45.00',
        currency: 'USD',
        entity: { userId: 'admin-user-1', tenantId: 'tenant-gym-1' },
      };
      mockRepo.findPlanById.mockResolvedValue(plan);

      const currentPriceRow = {
        id: 'price-row-old',
        planId: 'plan-1',
        price: '45.00',
        effectiveTo: null,
      };
      mockRepo.findCurrentPriceHistory.mockResolvedValue(currentPriceRow);
      mockRepo.closePriceHistory.mockResolvedValue(undefined);
      mockRepo.createPriceHistory.mockResolvedValue({
        id: 'price-row-new',
        price: '55.00',
        effectiveTo: null,
      });
      mockRepo.updatePlan.mockResolvedValue({ ...plan, currentPrice: '55.00' });

      const result = await service.updatePlanPrice(mockAdminUser, 'plan-1', {
        newPrice: 55,
        reason: 'Ajuste inflacionario anual autorizado',
        isPromotional: false,
      });

      expect(mockRepo.closePriceHistory).toHaveBeenCalledWith('price-row-old', expect.any(Date), expect.anything());
      expect(mockRepo.createPriceHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: 'plan-1',
          price: '55.00',
          changedByUserId: mockAdminUser.id,
          changeReason: 'Ajuste inflacionario anual autorizado',
          effectiveTo: null,
        }),
        expect.anything(),
      );
      expect(mockRepo.updatePlan).toHaveBeenCalledWith(plan, { currentPrice: '55.00', currency: 'USD' }, expect.anything());
    });

    it('rechaza actualizar el precio si el valor nuevo es idéntico al actual', async () => {
      mockRepo.findPlanById.mockResolvedValue({
        id: 'plan-1',
        currentPrice: '45.00',
        currency: 'USD',
        entity: { userId: 'admin-user-1' },
      });

      await expect(
        service.updatePlanPrice(mockAdminUser, 'plan-1', {
          newPrice: 45,
          reason: 'Mismo precio',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Módulo de Pagos Manuales (QR + Comprobante)', () => {
    it('crea orden congelando el snapshot de condiciones y precio para protección del atleta', async () => {
      const plan = {
        id: 'plan-1',
        entityId: 'entity-1',
        name: 'Plan Mensual',
        type: 'MEMBERSHIP_PLAN',
        description: 'Acceso a salas',
        benefits: ['Cardio'],
        durationDays: 30,
        currentPrice: '45.00',
        currency: 'USD',
        status: 'ACTIVE',
      };
      mockRepo.findPlanById.mockResolvedValue(plan);
      mockRepo.findCurrentPriceHistory.mockResolvedValue({ id: 'price-hist-active', price: '45.00' });
      mockRepo.findPaymentConfig.mockResolvedValue({
        id: 'cfg-1',
        bankName: 'Banco Santander',
        accountNumber: '123456789',
        qrImageUrl: 'https://gym.com/qr.png',
        isActive: true,
      });

      mockRepo.createOrder.mockImplementation(async (data: any) => ({
        id: 'order-1',
        ...data,
      }));

      const { order, paymentConfig } = await service.createPaymentOrder(mockAthleteUser, {
        planId: 'plan-1',
        athleteNotes: 'Pago por transferencia directa',
      });

      expect(order.id).toBe('order-1');
      expect(order.status).toBe('PENDING_PAYMENT');
      expect(order.amount).toBe('45.00');
      expect(order.priceHistoryId).toBe('price-hist-active');
      expect(order.planSnapshot).toEqual({
        id: 'plan-1',
        name: 'Plan Mensual',
        type: 'MEMBERSHIP_PLAN',
        description: 'Acceso a salas',
        benefits: ['Cardio'],
        durationDays: 30,
      });
      expect(paymentConfig?.bankName).toBe('Banco Santander');
    });

    it('permite al atleta subir el comprobante cambiando el estado a PENDING_VERIFICATION', async () => {
      const order = {
        id: 'order-1',
        athleteUserId: 'athlete-user-1',
        status: 'PENDING_PAYMENT',
      };
      mockRepo.findOrderById.mockResolvedValue(order);
      mockRepo.updateOrder.mockImplementation(async (_ord: any, data: any) => ({ ...order, ...data }));

      const updated = await service.submitReceipt(mockAthleteUser, 'order-1', {
        receiptUrl: 'https://storage.gymsheet.com/receipts/voucher-99.jpg',
        receiptReference: 'TRX-987654321',
        athleteNotes: 'Adjunto comprobante bancario',
      });

      expect(updated.status).toBe('PENDING_VERIFICATION');
      expect(updated.receiptUrl).toBe('https://storage.gymsheet.com/receipts/voucher-99.jpg');
      expect(updated.receiptReference).toBe('TRX-987654321');
      expect(updated.submittedAt).toBeInstanceOf(Date);
    });

    it('prohíbe que un usuario ajeno suba un comprobante a una orden que no le pertenece', async () => {
      mockRepo.findOrderById.mockResolvedValue({
        id: 'order-1',
        athleteUserId: 'athlete-user-1',
        status: 'PENDING_PAYMENT',
      });

      await expect(
        service.submitReceipt(mockOtherUser, 'order-1', {
          receiptUrl: 'https://storage.gymsheet.com/receipts/fake.jpg',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('confirma el comprobante, marca la orden como CONFIRMED y activa la membresía en el gimnasio', async () => {
      const order = {
        id: 'order-1',
        orderNumber: 'GS-ORD-1234',
        athleteUserId: 'athlete-user-1',
        planId: 'plan-1',
        status: 'PENDING_VERIFICATION',
        receiptUrl: 'https://storage.gymsheet.com/receipts/voucher.jpg',
        receiptReference: 'REF-111',
        entity: { userId: 'admin-user-1', tenantId: 'tenant-gym-1' },
        plan: { durationDays: 30 },
      };
      mockRepo.findOrderById.mockResolvedValue(order);
      mockMembershipService.createMembership.mockResolvedValue({ id: 'membership-activated-id' });
      mockRepo.updateOrder.mockImplementation(async (_ord: any, data: any) => ({ ...order, ...data }));

      const confirmed = await service.confirmOrder(mockAdminUser, 'order-1');

      expect(confirmed.status).toBe('CONFIRMED');
      expect(confirmed.verifiedByUserId).toBe(mockAdminUser.id);
      expect(confirmed.verifiedAt).toBeInstanceOf(Date);
      expect(confirmed.membershipId).toBe('membership-activated-id');
      expect(mockMembershipService.createMembership).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'athlete-user-1',
          planId: 'plan-1',
          externalReference: 'GS-ORD-1234',
        }),
        mockAdminUser.id,
      );
    });

    it('rechaza el comprobante con motivo si el administrador detecta datos no válidos', async () => {
      const order = {
        id: 'order-1',
        athleteUserId: 'athlete-user-1',
        status: 'PENDING_VERIFICATION',
        entity: { userId: 'admin-user-1', tenantId: 'tenant-gym-1' },
      };
      mockRepo.findOrderById.mockResolvedValue(order);
      mockRepo.updateOrder.mockImplementation(async (_ord: any, data: any) => ({ ...order, ...data }));

      const rejected = await service.rejectOrder(mockAdminUser, 'order-1', {
        reason: 'El importe transferido no coincide con la tarifa del plan.',
      });

      expect(rejected.status).toBe('REJECTED');
      expect(rejected.rejectionReason).toBe('El importe transferido no coincide con la tarifa del plan.');
      expect(rejected.verifiedByUserId).toBe(mockAdminUser.id);
    });
  });
});
