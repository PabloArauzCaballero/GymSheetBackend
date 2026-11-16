import { z } from "zod";
import { TrainingGoal } from "../../common/enums/domain.enums";
import {
  MAX_PROFILE_AGE,
  MIN_PROFILE_AGE,
  ageFromBirthDate,
  isCalendarDate,
} from "./birth-date";

const MIN_AGE_MESSAGE = `Debes tener al menos ${MIN_PROFILE_AGE} años.`;
const MAX_AGE_MESSAGE = `La edad no puede superar los ${MAX_PROFILE_AGE} años.`;

const birthDateSchema = z
  .string()
  .refine(isCalendarDate, "fechaNacimiento debe ser una fecha válida YYYY-MM-DD.")
  .refine((value) => ageFromBirthDate(value) >= MIN_PROFILE_AGE, MIN_AGE_MESSAGE)
  .refine((value) => ageFromBirthDate(value) <= MAX_PROFILE_AGE, MAX_AGE_MESSAGE);

/**
 * Preserves the v1 Spanish request contract while producing an English
 * application-layer object.
 *
 * `fechaNacimiento` is the current field. `edad` is still accepted because
 * installed app versions send it; when both arrive, the date wins. Omitting
 * both leaves the stored values untouched; `fechaNacimiento: null` clears them.
 */
export const upsertProfileSchema = z
  .object({
    fechaNacimiento: birthDateSchema.nullable().optional(),
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
  .transform(({ fechaNacimiento, edad, pesoKg, estaturaCm, objetivo }) => ({
    ...birthFields(fechaNacimiento, edad),
    weightKg: pesoKg,
    heightCm: estaturaCm,
    goal: objetivo,
  }));

function birthFields(
  birthDate: string | null | undefined,
  age: number | null | undefined,
): { birthDate?: string | null; age?: number | null } {
  if (birthDate !== undefined) {
    return { birthDate, age: birthDate === null ? null : ageFromBirthDate(birthDate) };
  }
  return age === undefined ? {} : { age };
}

export type UpsertProfileInput = z.infer<typeof upsertProfileSchema>;
