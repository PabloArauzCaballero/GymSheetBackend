import { z } from "zod";
import { TrainingGoal } from "../../common/enums/domain.enums";
import {
  MAX_PROFILE_AGE,
  MIN_PROFILE_AGE,
  ageFromBirthDate,
  isCalendarDate,
} from "./birth-date";

const birthDateSchema = z
  .string()
  .refine(isCalendarDate, "fechaNacimiento debe ser una fecha válida YYYY-MM-DD.")
  .refine((value) => {
    const age = ageFromBirthDate(value);
    return age >= MIN_PROFILE_AGE && age <= MAX_PROFILE_AGE;
  }, `La edad debe estar entre ${MIN_PROFILE_AGE} y ${MAX_PROFILE_AGE} años.`);

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
    edad: z.number().int().min(MIN_PROFILE_AGE).max(MAX_PROFILE_AGE).nullable().optional(),
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
