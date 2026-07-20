import { z } from 'zod';
import {
  AccessDirection,
  FacilityStatus,
  MaintenanceStatus,
  MaintenanceType,
  RoomStatus,
  RoomType,
} from '../../common/enums/domain.enums';

const codeSchema = z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9._-]+$/);
const nameSchema = z.string().trim().min(2).max(180);
const descriptionSchema = z.string().trim().max(2000).nullable();
const metadataSchema = z.record(z.string(), z.unknown()).refine(
  (value) => JSON.stringify(value).length <= 16384,
  'Los metadatos no pueden superar 16 KiB.',
);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const createBranchSchema = z
  .object({
    codigo: codeSchema,
    nombre: nameSchema,
    descripcion: descriptionSchema.optional(),
    zonaHoraria: z.string().trim().min(3).max(80).default('America/La_Paz'),
    metadata: metadataSchema.default({}),
  })
  .transform((input) => ({
    code: input.codigo.toUpperCase(),
    name: input.nombre,
    description: input.descripcion ?? null,
    timeZone: input.zonaHoraria,
    metadata: input.metadata,
  }));

export const updateBranchSchema = z
  .object({
    nombre: nameSchema.optional(),
    descripcion: descriptionSchema.optional(),
    zonaHoraria: z.string().trim().min(3).max(80).optional(),
    estado: z.nativeEnum(FacilityStatus).optional(),
    metadata: metadataSchema.optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined))
  .transform((input) => ({
    ...(input.nombre !== undefined ? { name: input.nombre } : {}),
    ...(input.descripcion !== undefined ? { description: input.descripcion } : {}),
    ...(input.zonaHoraria !== undefined ? { timeZone: input.zonaHoraria } : {}),
    ...(input.estado !== undefined ? { status: input.estado } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  }));

export const createRoomSchema = z
  .object({
    sedeId: z.string().uuid(),
    codigo: codeSchema,
    nombre: nameSchema,
    tipoSala: z.nativeEnum(RoomType),
    capacidad: z.number().int().min(1).max(100000).nullable().optional(),
    metadata: metadataSchema.default({}),
  })
  .transform((input) => ({
    branchId: input.sedeId,
    code: input.codigo.toUpperCase(),
    name: input.nombre,
    roomType: input.tipoSala,
    capacity: input.capacidad ?? null,
    metadata: input.metadata,
  }));

export const updateRoomSchema = z
  .object({
    nombre: nameSchema.optional(),
    tipoSala: z.nativeEnum(RoomType).optional(),
    capacidad: z.number().int().min(1).max(100000).nullable().optional(),
    estado: z.nativeEnum(RoomStatus).optional(),
    metadata: metadataSchema.optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined))
  .transform((input) => ({
    ...(input.nombre !== undefined ? { name: input.nombre } : {}),
    ...(input.tipoSala !== undefined ? { roomType: input.tipoSala } : {}),
    ...(input.capacidad !== undefined ? { capacity: input.capacidad } : {}),
    ...(input.estado !== undefined ? { status: input.estado } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  }));

export const createAccessPointSchema = z
  .object({
    sedeId: z.string().uuid(),
    salaId: z.string().uuid().nullable().optional(),
    codigo: codeSchema,
    nombre: nameSchema,
    direccionPermitida: z.nativeEnum(AccessDirection).default(AccessDirection.BOTH),
    metadata: metadataSchema.default({}),
  })
  .transform((input) => ({
    branchId: input.sedeId,
    roomId: input.salaId ?? null,
    code: input.codigo.toUpperCase(),
    name: input.nombre,
    allowedDirection: input.direccionPermitida,
    metadata: input.metadata,
  }));

export const assignEquipmentSchema = z
  .object({
    equipoId: z.string().uuid(),
    salaId: z.string().uuid(),
    notas: z.string().trim().max(2000).nullable().optional(),
  })
  .transform((input) => ({
    equipmentId: input.equipoId,
    roomId: input.salaId,
    notes: input.notas ?? null,
  }));

export const scheduleMaintenanceSchema = z
  .object({
    equipoId: z.string().uuid(),
    tipo: z.nativeEnum(MaintenanceType),
    programadoPara: z.string().date(),
    descripcion: z.string().trim().min(3).max(4000),
    proveedor: z.string().trim().max(180).nullable().optional(),
    tecnico: z.string().trim().max(180).nullable().optional(),
    metadata: metadataSchema.default({}),
  })
  .transform((input) => ({
    equipmentId: input.equipoId,
    maintenanceType: input.tipo,
    scheduledFor: input.programadoPara,
    description: input.descripcion,
    vendorName: input.proveedor ?? null,
    technicianName: input.tecnico ?? null,
    metadata: input.metadata,
  }));

export const completeMaintenanceSchema = z
  .object({
    hallazgos: z.string().trim().max(4000).nullable().optional(),
    resolucion: z.string().trim().min(3).max(4000),
    costo: z.number().min(0).max(9999999999).nullable().optional(),
    moneda: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  })
  .superRefine((input, context) => {
    if ((input.costo === null || input.costo === undefined) !== (input.moneda === null || input.moneda === undefined)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Costo y moneda deben enviarse juntos.' });
    }
  })
  .transform((input) => ({
    findings: input.hallazgos ?? null,
    resolution: input.resolucion,
    costAmount: input.costo ?? null,
    costCurrency: input.moneda ?? null,
  }));

export const maintenanceFilterSchema = paginationSchema.extend({
  equipoId: z.string().uuid().optional(),
  estado: z.nativeEnum(MaintenanceStatus).optional(),
});

export type PaginationInput = z.infer<typeof paginationSchema>;
export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;
export type CreateAccessPointInput = z.infer<typeof createAccessPointSchema>;
export type AssignEquipmentInput = z.infer<typeof assignEquipmentSchema>;
export type ScheduleMaintenanceInput = z.infer<typeof scheduleMaintenanceSchema>;
export type CompleteMaintenanceInput = z.infer<typeof completeMaintenanceSchema>;
export type MaintenanceFilterInput = z.infer<typeof maintenanceFilterSchema>;
