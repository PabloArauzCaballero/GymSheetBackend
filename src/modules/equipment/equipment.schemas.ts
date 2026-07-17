import { z } from 'zod';
import { EquipmentStatus, EquipmentType } from '../../common/enums/domain.enums';

const equipmentNameSchema = z.string().trim().min(2).max(140);
const equipmentDescriptionSchema = z.string().trim().max(500).nullable();

/** Converts the existing v1 Spanish request contract to English internals. */
export const createEquipmentSchema = z
  .object({
    nombre: equipmentNameSchema,
    tipo: z.nativeEnum(EquipmentType),
    descripcion: equipmentDescriptionSchema.optional(),
  })
  .transform(({ nombre, tipo, descripcion }) => ({
    name: nombre,
    type: tipo,
    description: descripcion ?? null,
  }));

export const updateEquipmentSchema = z
  .object({
    nombre: equipmentNameSchema.optional(),
    tipo: z.nativeEnum(EquipmentType).optional(),
    descripcion: equipmentDescriptionSchema.optional(),
    estado: z.nativeEnum(EquipmentStatus).optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Debe enviar al menos un campo para actualizar.',
  })
  .transform(({ nombre, tipo, descripcion, estado }) => ({
    ...(nombre !== undefined ? { name: nombre } : {}),
    ...(tipo !== undefined ? { type: tipo } : {}),
    ...(descripcion !== undefined ? { description: descripcion } : {}),
    ...(estado !== undefined ? { status: estado } : {}),
  }));

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;
