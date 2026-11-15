import { z } from "zod";
import { FitnessGoal } from "../../common/enums/domain.enums";

export const onboardingProfileSchema = z.object({
  weight: z.number().positive().max(1000),
  weightUnit: z.enum(["KG", "LB"]),
  height: z.number().positive().max(300),
  heightUnit: z.enum(["CM", "IN"]),
  measuredOn: z.string().date(),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});

export const onboardingGoalsSchema = z.object({
  primaryGoal: z.nativeEnum(FitnessGoal),
});

export const onboardingPreferencesSchema = z.object({
  experienceLevel: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]),
  weeklyFrequency: z.number().int().min(1).max(7),
  trainingLocation: z.enum(["GYM", "HOME", "OUTDOORS", "MIXED"]),
  trainingPreferences: z.array(z.string().trim().min(1).max(80)).max(20),
  physicalConsiderations: z.string().trim().max(2000).nullable().optional(),
  consentHealth: z.boolean(),
  consentData: z.boolean(),
});

/**
 * Editar nivel e intereses desde el perfil, una vez terminado el alta.
 *
 * No reutiliza `onboardingPreferencesSchema`: aquel exige los consentimientos y
 * su guardado devuelve el alta a «en curso», que en la web vuelve a encerrar a
 * la persona en el cuestionario. Esto solo cambia lo que se envía.
 */
export const trainingProfileUpdateSchema = z
  .object({
    experienceLevel: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]),
    weeklyFrequency: z.number().int().min(1).max(7),
    trainingLocation: z.enum(["GYM", "HOME", "OUTDOORS", "MIXED"]),
    trainingPreferences: z
      .array(z.string().trim().min(1).max(80))
      .max(20)
      .transform((items) => [...new Set(items)]),
  })
  .partial()
  .strict()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: "Debe enviar al menos un campo para actualizar.",
  });

export const onboardingEquipmentSchema = z.object({
  availableEquipment: z.array(z.string().trim().min(1).max(80)).max(50),
});

export const bodyMeasurementSchema = z.object({
  weight: z.number().positive().max(1000),
  unit: z.enum(["KG", "LB"]),
  measuredOn: z.string().date(),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});

export type OnboardingProfileInput = z.infer<typeof onboardingProfileSchema>;
export type OnboardingGoalsInput = z.infer<typeof onboardingGoalsSchema>;
export type OnboardingPreferencesInput = z.infer<
  typeof onboardingPreferencesSchema
>;
export type OnboardingEquipmentInput = z.infer<
  typeof onboardingEquipmentSchema
>;
export type TrainingProfileUpdateInput = z.infer<typeof trainingProfileUpdateSchema>;
export type BodyMeasurementInput = z.infer<typeof bodyMeasurementSchema>;
