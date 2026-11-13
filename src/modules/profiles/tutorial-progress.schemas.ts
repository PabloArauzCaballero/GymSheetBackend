import { z } from "zod";

/** Mismos estados que `tutorialProgressStatuses` de `@gymsheet/types`. */
export const TUTORIAL_PROGRESS_STATUSES = ["IN_PROGRESS", "COMPLETED", "SKIPPED"] as const;

/** Ids de guía tal como los define el registro de la web (`platform-intro`, `senda`…). */
export const tutorialIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9:._-]*$/iu, "Identificador de guía no válido.");

/** Cuerpo de `PUT /me/tutorial-progress/:tutorialId` (idempotente). */
export const tutorialProgressUpsertSchema = z.object({
  status: z.enum(TUTORIAL_PROGRESS_STATUSES),
  version: z.string().trim().min(1).max(40),
  currentStepId: z.string().trim().min(1).max(120).nullable().optional(),
  startedAt: z.string().datetime({ offset: true }).nullable().optional(),
  completedAt: z.string().datetime({ offset: true }).nullable().optional(),
  repeatCount: z.number().int().nonnegative().max(10_000).optional(),
});

export type TutorialProgressUpsertInput = z.infer<typeof tutorialProgressUpsertSchema>;
