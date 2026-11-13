import { z } from "zod";

export const tutorialProgressStatuses = ["IN_PROGRESS", "COMPLETED", "SKIPPED"] as const;
export type TutorialProgressStatus = (typeof tutorialProgressStatuses)[number];

/** El id lo elige el catálogo de la web: letras, números y `- _ . :`, sin espacios. */
export const tutorialIdParamSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, "tutorialId inválido");

const isoDate = z.string().datetime({ offset: true });

/**
 * Cuerpo del PUT. Un campo AUSENTE conserva lo guardado; `null` lo borra.
 * `startedAt`/`completedAt`/`repeatCount` los manda la web, no se calculan aquí.
 */
export const tutorialProgressUpsertSchema = z.object({
  status: z.enum(tutorialProgressStatuses),
  version: z.string().trim().min(1).max(40),
  currentStepId: z.string().trim().min(1).max(100).nullable().optional(),
  startedAt: isoDate.nullable().optional(),
  completedAt: isoDate.nullable().optional(),
  repeatCount: z.number().int().min(0).max(100000).optional(),
});
export type TutorialProgressUpsertInput = z.infer<typeof tutorialProgressUpsertSchema>;

/** Forma pública del registro: la misma que valida `tutorialProgressRecordSchema` en la web. */
export interface TutorialProgressRecordDto {
  tutorialId: string;
  status: TutorialProgressStatus;
  version: string;
  currentStepId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastInteractionAt: string;
  repeatCount: number;
}
