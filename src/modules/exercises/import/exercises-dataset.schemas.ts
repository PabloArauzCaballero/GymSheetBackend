import { z } from 'zod';

const languageCodeSchema = z.string().regex(/^[a-z]{2}$/);
const instructionMapSchema = z.record(
  languageCodeSchema,
  z.string().trim().min(1).max(8000),
);
const instructionStepsSchema = z.record(
  languageCodeSchema,
  z.array(z.string().trim().min(1).max(1500)).max(40),
);

/** Runtime contract for the external exercises-dataset repository. */
export const externalExerciseSchema = z
  .object({
    id: z.string().regex(/^\d{4}$/),
    name: z.string().trim().min(1).max(160),
    category: z.string().trim().min(1).max(100),
    body_part: z.string().trim().min(1).max(100),
    equipment: z.string().trim().min(1).max(160),
    instructions: instructionMapSchema,
    instruction_steps: instructionStepsSchema,
    muscle_group: z.string().trim().min(1).max(120),
    secondary_muscles: z.array(z.string().trim().min(1).max(120)).max(30),
    target: z.string().trim().min(1).max(120),
    media_id: z.string().trim().min(1).max(180),
    image: z.string().regex(/^images\/.+\.(?:jpg|jpeg|png)$/i),
    gif_url: z.string().regex(/^videos\/.+\.gif$/i),
    attribution: z.string().trim().min(1).max(2000),
    created_at: z.string().datetime({ offset: true }),
  })
  .strict();

export const externalExerciseDatasetSchema = z
  .array(externalExerciseSchema)
  .min(1)
  .max(5000)
  .superRefine((records, context) => {
    const seenIdentifiers = new Set<string>();

    records.forEach((record, index) => {
      if (seenIdentifiers.has(record.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'id'],
          message: `Duplicate external exercise identifier: ${record.id}.`,
        });
      }
      seenIdentifiers.add(record.id);
    });
  });

export const exerciseDatasetImportOptionsSchema = z.object({
  dryRun: z.boolean().default(false),
  importMedia: z.boolean().optional(),
});

export type ExternalExercise = z.infer<typeof externalExerciseSchema>;
export type ExerciseDatasetImportOptions = z.infer<
  typeof exerciseDatasetImportOptionsSchema
>;
