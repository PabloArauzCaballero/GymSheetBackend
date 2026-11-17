import { z } from "zod";
import { TrainingGoal } from "../../common/enums/domain.enums";
import {
  MAX_AGE_MESSAGE,
  MAX_PROFILE_AGE,
  MIN_AGE_MESSAGE,
  MIN_PROFILE_AGE,
  adultBirthDateSchema,
} from "./birth-date";

/**
 * Preserves the v1 Spanish request contract while producing an English
 * application-layer object.
 *
 * `fechaNacimiento` is written to the account (`usuarios.fecha_nacimiento`),
 * the single source of age. Omitting it leaves the stored date untouched and
 * `null` clears it. The legacy `edad` is still validated (18–100) because
 * installed app versions send it, but it is not stored: an age without a date
 * goes stale, and the date is now captured at signup.
 */
export const upsertProfileSchema = z
  .object({
    fechaNacimiento: adultBirthDateSchema.nullable().optional(),
    edad: z
      .number()
      .int()
      .min(MIN_PROFILE_AGE, MIN_AGE_MESSAGE)
      .max(MAX_PROFILE_AGE, MAX_AGE_MESSAGE)
      .nullable()
      .optional(),
    pesoKg: z.number().min(1).max(400),
    estaturaCm: z.number().int().min(80).max(250),
    objetivo: z.nativeEnum(TrainingGoal),
  })
  .transform(({ fechaNacimiento, pesoKg, estaturaCm, objetivo }) => ({
    ...(fechaNacimiento === undefined ? {} : { birthDate: fechaNacimiento }),
    weightKg: pesoKg,
    heightCm: estaturaCm,
    goal: objetivo,
  }));

export type UpsertProfileInput = z.infer<typeof upsertProfileSchema>;
