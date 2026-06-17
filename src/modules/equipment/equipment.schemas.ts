import { z } from 'zod';
import { EquipmentStatus, EquipmentType } from '../../common/enums/domain.enums';

export const createEquipmentSchema = z.object({
  nombre: z.string().min(2).max(140),
  tipo: z.nativeEnum(EquipmentType),
  descripcion: z.string().max(500).optional().nullable(),
});

export const updateEquipmentSchema = createEquipmentSchema.partial().extend({
  estado: z.nativeEnum(EquipmentStatus).optional(),
});

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;
