import { z } from 'zod';
import { EmploymentStatus, MembershipStatus, PlanStatus, PlanType, StaffPosition } from '../../common/enums/domain.enums';

const metadataSchema = z.record(z.string(), z.unknown()).refine(
  (value) => JSON.stringify(value).length <= 16384,
  'Los metadatos no pueden superar 16 KiB.',
);
const paginationSchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
const scopeSchema = z.object({ sedeId: z.string().uuid(), salaId: z.string().uuid().nullable().optional() });

export const membershipListSchema = paginationSchema.extend({
  userId: z.string().uuid().optional(),
  estado: z.nativeEnum(MembershipStatus).optional(),
});

export const createPlanSchema = z
  .object({
    codigo: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9._-]+$/),
    nombre: z.string().trim().min(2).max(180),
    descripcion: z.string().trim().max(2000).nullable().optional(),
    tipo: z.nativeEnum(PlanType),
    duracionDias: z.number().int().min(1).max(3650),
    diasRecordatorio: z.array(z.number().int().min(0).max(3650)).max(30).default([7, 3, 1, 0]),
    alcances: z.array(scopeSchema).min(1).max(100),
    metadata: metadataSchema.default({}),
  })
  .transform((input) => ({
    code: input.codigo.toUpperCase(),
    name: input.nombre,
    description: input.descripcion ?? null,
    planType: input.tipo,
    durationDays: input.duracionDias,
    reminderDays: [...new Set(input.diasRecordatorio)].sort((a, b) => b - a),
    scopes: input.alcances.map((scope) => ({ branchId: scope.sedeId, roomId: scope.salaId ?? null })),
    metadata: input.metadata,
  }));

export const updatePlanSchema = z
  .object({
    nombre: z.string().trim().min(2).max(180).optional(),
    descripcion: z.string().trim().max(2000).nullable().optional(),
    tipo: z.nativeEnum(PlanType).optional(),
    duracionDias: z.number().int().min(1).max(3650).optional(),
    diasRecordatorio: z.array(z.number().int().min(0).max(3650)).max(30).optional(),
    estado: z.nativeEnum(PlanStatus).optional(),
    metadata: metadataSchema.optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined))
  .transform((input) => ({
    ...(input.nombre !== undefined ? { name: input.nombre } : {}),
    ...(input.descripcion !== undefined ? { description: input.descripcion } : {}),
    ...(input.tipo !== undefined ? { planType: input.tipo } : {}),
    ...(input.duracionDias !== undefined ? { durationDays: input.duracionDias } : {}),
    ...(input.diasRecordatorio !== undefined ? { reminderDays: [...new Set(input.diasRecordatorio)].sort((a, b) => b - a) } : {}),
    ...(input.estado !== undefined ? { status: input.estado } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  }));

export const replacePlanScopesSchema = z.object({ alcances: z.array(scopeSchema).min(1).max(100) }).transform((input) => ({ scopes: input.alcances.map((scope) => ({ branchId: scope.sedeId, roomId: scope.salaId ?? null })) }));

export const createCustomerSchema = z
  .object({
    email: z.string().trim().email().max(180).transform((value) => value.toLowerCase()),
    password: z.string().min(10).max(128),
    nombreCompleto: z.string().trim().min(3).max(180),
    numeroCliente: z.string().trim().min(2).max(80),
    telefono: z.string().trim().min(5).max(40).nullable().optional(),
    referenciaExterna: z.string().trim().min(1).max(180).nullable().optional(),
    notas: z.string().trim().max(2000).nullable().optional(),
    metadata: metadataSchema.default({}),
  })
  .transform((input) => ({
    email: input.email,
    password: input.password,
    fullName: input.nombreCompleto,
    customerNumber: input.numeroCliente.toUpperCase(),
    phoneNumber: input.telefono ?? null,
    externalReference: input.referenciaExterna ?? null,
    notes: input.notas ?? null,
    metadata: input.metadata,
  }));

export const createMembershipSchema = z
  .object({
    clienteUsuarioId: z.string().uuid(),
    planId: z.string().uuid(),
    iniciaEl: z.string().date().optional(),
    referenciaExterna: z.string().trim().min(1).max(180).nullable().optional(),
    notas: z.string().trim().max(2000).nullable().optional(),
    metadata: metadataSchema.default({}),
  })
  .transform((input) => ({
    userId: input.clienteUsuarioId,
    planId: input.planId,
    startsOn: input.iniciaEl,
    externalReference: input.referenciaExterna ?? null,
    notes: input.notas ?? null,
    metadata: input.metadata,
  }));

export const membershipStatusSchema = z.object({ estado: z.nativeEnum(MembershipStatus), motivo: z.string().trim().max(2000).nullable().optional() }).transform((input) => ({ status: input.estado, reason: input.motivo ?? null }));

export const createStaffSchema = z
  .object({
    usuarioId: z.string().uuid(),
    cargo: z.nativeEnum(StaffPosition),
    contratadoEl: z.string().date(),
    accesoIlimitado: z.boolean().default(true),
    sedes: z.array(z.string().uuid()).min(1).max(100),
    metadata: metadataSchema.default({}),
  })
  .transform((input) => ({ userId: input.usuarioId, position: input.cargo, hiredOn: input.contratadoEl, unlimitedAccess: input.accesoIlimitado, branchIds: [...new Set(input.sedes)], metadata: input.metadata }));

export const updateStaffStatusSchema = z.object({ estadoLaboral: z.nativeEnum(EmploymentStatus), terminadoEl: z.string().date().nullable().optional() }).transform((input) => ({ employmentStatus: input.estadoLaboral, terminatedOn: input.terminadoEl ?? null }));

export type MembershipListInput = z.infer<typeof membershipListSchema>;
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type ReplacePlanScopesInput = z.infer<typeof replacePlanScopesSchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type CreateMembershipInput = z.infer<typeof createMembershipSchema>;
export type MembershipStatusInput = z.infer<typeof membershipStatusSchema>;
export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffStatusInput = z.infer<typeof updateStaffStatusSchema>;
