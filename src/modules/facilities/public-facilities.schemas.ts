import { z } from 'zod';
import { RoomType } from '../../common/enums/domain.enums';

/**
 * Solo estos tipos de sala son "servicios" desde la mirada de una persona
 * eligiendo gimnasio: vestidores, recepción y áreas de personal no son un
 * servicio que alguien busque en un directorio público.
 */
export const publicRoomTypes = [
  RoomType.TRAINING,
  RoomType.CARDIO,
  RoomType.FUNCTIONAL,
  RoomType.CLASSROOM,
] as const;

export const publicBranchListQuerySchema = z.object({
  /** Busca en nombre y descripción de la sede — es lo más cercano a "ubicación" que hoy modela el sistema. */
  search: z.string().trim().min(1).max(120).optional(),
  servicio: z.nativeEnum(RoomType).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type PublicBranchListQuery = z.infer<typeof publicBranchListQuerySchema>;
