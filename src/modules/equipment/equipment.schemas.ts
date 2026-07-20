import { z } from 'zod';
import { EquipmentStatus, EquipmentType } from '../../common/enums/domain.enums';

const nameSchema = z.string().trim().min(2).max(140);
const descriptionSchema = z.string().trim().max(1000).nullable();
const nullableTextSchema = (max: number) => z.string().trim().min(1).max(max).nullable();
const dateOnlySchema = z.string().date().nullable();
const metadataSchema = z.record(z.string(), z.unknown()).refine(
  (value) => JSON.stringify(value).length <= 16384,
  'Los metadatos no pueden superar 16 KiB.',
);

const assetFields = {
  etiquetaActivo: nullableTextSchema(100).optional(),
  numeroSerie: nullableTextSchema(180).optional(),
  fabricante: nullableTextSchema(160).optional(),
  modelo: nullableTextSchema(160).optional(),
  fechaCompra: dateOnlySchema.optional(),
  garantiaHasta: dateOnlySchema.optional(),
  intervaloServicioDias: z.number().int().min(1).max(3650).nullable().optional(),
  proximoServicio: dateOnlySchema.optional(),
  razonFueraServicio: nullableTextSchema(2000).optional(),
  metadata: metadataSchema.optional(),
};

export const createEquipmentSchema = z
  .object({
    nombre: nameSchema,
    tipo: z.nativeEnum(EquipmentType),
    descripcion: descriptionSchema.optional(),
    ...assetFields,
  })
  .transform((input) => ({
    name: input.nombre,
    type: input.tipo,
    description: input.descripcion ?? null,
    assetTag: input.etiquetaActivo ?? null,
    serialNumber: input.numeroSerie ?? null,
    manufacturer: input.fabricante ?? null,
    modelName: input.modelo ?? null,
    purchasedOn: input.fechaCompra ?? null,
    warrantyExpiresOn: input.garantiaHasta ?? null,
    serviceIntervalDays: input.intervaloServicioDias ?? null,
    nextServiceOn: input.proximoServicio ?? null,
    outOfServiceReason: input.razonFueraServicio ?? null,
    metadata: input.metadata ?? {},
  }));

export const updateEquipmentSchema = z
  .object({
    nombre: nameSchema.optional(),
    tipo: z.nativeEnum(EquipmentType).optional(),
    descripcion: descriptionSchema.optional(),
    estado: z.nativeEnum(EquipmentStatus).optional(),
    ...assetFields,
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Debe enviar al menos un campo para actualizar.',
  })
  .transform((input) => ({
    ...(input.nombre !== undefined ? { name: input.nombre } : {}),
    ...(input.tipo !== undefined ? { type: input.tipo } : {}),
    ...(input.descripcion !== undefined ? { description: input.descripcion } : {}),
    ...(input.estado !== undefined ? { status: input.estado } : {}),
    ...(input.etiquetaActivo !== undefined ? { assetTag: input.etiquetaActivo } : {}),
    ...(input.numeroSerie !== undefined ? { serialNumber: input.numeroSerie } : {}),
    ...(input.fabricante !== undefined ? { manufacturer: input.fabricante } : {}),
    ...(input.modelo !== undefined ? { modelName: input.modelo } : {}),
    ...(input.fechaCompra !== undefined ? { purchasedOn: input.fechaCompra } : {}),
    ...(input.garantiaHasta !== undefined ? { warrantyExpiresOn: input.garantiaHasta } : {}),
    ...(input.intervaloServicioDias !== undefined
      ? { serviceIntervalDays: input.intervaloServicioDias }
      : {}),
    ...(input.proximoServicio !== undefined ? { nextServiceOn: input.proximoServicio } : {}),
    ...(input.razonFueraServicio !== undefined
      ? { outOfServiceReason: input.razonFueraServicio }
      : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  }));

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;
