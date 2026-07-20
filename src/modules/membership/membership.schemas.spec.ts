import { PlanType } from '../../common/enums/domain.enums';
import {
  createCustomerSchema,
  createPlanSchema,
} from './membership.schemas';

describe('membership schemas', () => {
  it('normalizes customer onboarding and keeps the access PIN internal', () => {
    const result = createCustomerSchema.parse({
      email: 'CLIENT@example.test',
      password: 'a-secure-test-password',
      pinAcceso: '482917',
      nombreCompleto: 'Cliente de Prueba',
      numeroCliente: 'scz-001',
      metadata: {},
    });

    expect(result).toMatchObject({
      email: 'client@example.test',
      accessPin: '482917',
      customerNumber: 'SCZ-001',
    });
  });

  it('rejects onboarding without an access PIN', () => {
    const result = createCustomerSchema.safeParse({
      email: 'client@example.test',
      password: 'a-secure-test-password',
      nombreCompleto: 'Cliente de Prueba',
      numeroCliente: 'SCZ-001',
      metadata: {},
    });
    expect(result.success).toBe(false);
  });

  it('deduplicates and orders reminder thresholds', () => {
    const result = createPlanSchema.parse({
      codigo: 'mensual',
      nombre: 'Plan Mensual',
      tipo: PlanType.MONTHLY,
      duracionDias: 30,
      diasRecordatorio: [1, 7, 3, 7, 0],
      alcances: [
        { sedeId: '550e8400-e29b-41d4-a716-446655440000' },
      ],
      metadata: {},
    });
    expect(result.reminderDays).toEqual([7, 3, 1, 0]);
  });
});
