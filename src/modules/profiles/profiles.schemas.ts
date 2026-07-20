import { z } from 'zod';
import { TrainingGoal } from '../../common/enums/domain.enums';

/**
 * Preserves the v1 Spanish request contract while producing an English
 * application-layer object.
 */
export const upsertProfileSchema = z
  .object({
    edad: z.number().int().min(12).max(100),
    pesoKg: z.number().min(1).max(400),
    estaturaCm: z.number().int().min(80).max(250),
    objetivo: z.nativeEnum(TrainingGoal),
  })
  .transform(({ edad, pesoKg, estaturaCm, objetivo }) => ({
    age: edad,
    weightKg: pesoKg,
    heightCm: estaturaCm,
    goal: objetivo,
  }));

export type UpsertProfileInput = z.infer<typeof upsertProfileSchema>;
