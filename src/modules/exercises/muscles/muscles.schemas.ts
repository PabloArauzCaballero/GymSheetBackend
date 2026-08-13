import { z } from "zod";

/** Preferencia personal de un usuario sobre un ejercicio (me gusta / valoración). */
export const exercisePreferenceSchema = z
  .object({
    isFavorite: z.boolean().optional(),
    personalRating: z.number().int().min(1).max(5).nullable().optional(),
    notes: z.string().trim().max(300).nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.isFavorite !== undefined ||
      value.personalRating !== undefined ||
      value.notes !== undefined,
    { message: "Envía al menos un campo (isFavorite, personalRating o notes)." },
  );

export type ExercisePreferenceInput = z.infer<typeof exercisePreferenceSchema>;
