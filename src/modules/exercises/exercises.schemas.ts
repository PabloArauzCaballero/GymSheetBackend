import { z } from 'zod';
import {
  ExerciseDataSource,
  ExerciseMediaProvider,
  ExerciseMediaType,
} from '../../common/enums/domain.enums';

const exerciseNameSchema = z.string().trim().min(2).max(160);
const muscleNameSchema = z.string().trim().min(2).max(120);
const nullableDescriptionSchema = z.string().trim().max(2000).nullable();
const equipmentIdsSchema = z.array(z.string().uuid()).max(30).default([]);
const languageCodeSchema = z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/);

const localizedInstructionsSchema = z
  .record(languageCodeSchema, z.string().trim().min(1).max(6000))
  .refine((value) => Object.keys(value).length <= 20, {
    message: 'No se permiten más de 20 idiomas por ejercicio.',
  });

const localizedInstructionStepsSchema = z
  .record(
    languageCodeSchema,
    z.array(z.string().trim().min(1).max(1000)).min(1).max(30),
  )
  .refine((value) => Object.keys(value).length <= 20, {
    message: 'No se permiten más de 20 idiomas por ejercicio.',
  });

const metadataSchema = z.record(z.string(), z.unknown()).refine(
  (metadata) => JSON.stringify(metadata).length <= 16384,
  { message: 'Los metadatos no pueden superar 16 KiB.' },
);

const exerciseRequestSchema = z.object({
  nombre: exerciseNameSchema,
  grupoMuscular: muscleNameSchema,
  descripcion: nullableDescriptionSchema.optional(),
  equipoIds: equipmentIdsSchema.optional(),
  bodyPart: z.string().trim().min(2).max(100).optional().nullable(),
  targetMuscle: muscleNameSchema.optional().nullable(),
  synergistMuscleGroup: muscleNameSchema.optional().nullable(),
  secondaryMuscles: z.array(muscleNameSchema).max(30).optional(),
  instructions: localizedInstructionsSchema.optional(),
  instructionSteps: localizedInstructionStepsSchema.optional(),
  metadata: metadataSchema.optional(),
});

/** Converts legacy v1 names to the English application contract. */
export const createGlobalExerciseSchema = exerciseRequestSchema.transform(
  ({ nombre, grupoMuscular, descripcion, equipoIds, ...extendedData }) => ({
    name: nombre,
    muscleGroup: grupoMuscular,
    description: descripcion ?? null,
    equipmentIds: equipoIds ?? [],
    bodyPart: extendedData.bodyPart ?? null,
    targetMuscle: extendedData.targetMuscle ?? null,
    synergistMuscleGroup: extendedData.synergistMuscleGroup ?? null,
    secondaryMuscles: extendedData.secondaryMuscles ?? [],
    instructions: extendedData.instructions ?? {},
    instructionSteps: extendedData.instructionSteps ?? {},
    metadata: extendedData.metadata ?? {},
  }),
);

/**
 * Alta de un ejercicio propio.
 *
 * Aquí la persona configura el **músculo** y el equipamiento se deduce solo, así
 * que `grupoMuscular` deja de ser obligatorio: si llega `muscleCode`, el
 * servidor rellena grupo, músculo objetivo y equipamiento desde el catálogo.
 *
 * Sigue aceptándose la forma antigua —grupo muscular escrito a mano— porque el
 * portal web ya la usa y romperla dejaría sin crear ejercicios a quien no haya
 * actualizado. Lo que no se acepta es no enviar ninguna de las dos: sin músculo
 * ni grupo, el ejercicio no se puede clasificar ni recomendar.
 */
export const createPersonalExerciseSchema = z
  .object({
    nombre: exerciseNameSchema,
    grupoMuscular: muscleNameSchema.optional(),
    /** Código canónico de la taxonomía (`PECTORALIS_MAJOR`). */
    muscleCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .max(60)
      .optional(),
    descripcion: nullableDescriptionSchema.optional(),
    equipoIds: equipmentIdsSchema.optional(),
    /**
     * Etiqueta de equipamiento elegida por la persona entre las que propone el
     * servidor. Ausente = se acepta la que el catálogo considere más habitual.
     */
    equipmentLabel: z.string().trim().min(2).max(160).optional(),
    bodyPart: z.string().trim().min(2).max(100).optional().nullable(),
    targetMuscle: muscleNameSchema.optional().nullable(),
    synergistMuscleGroup: muscleNameSchema.optional().nullable(),
    secondaryMuscles: z.array(muscleNameSchema).max(30).optional(),
    instructions: localizedInstructionsSchema.optional(),
    instructionSteps: localizedInstructionStepsSchema.optional(),
    metadata: metadataSchema.optional(),
  })
  .refine((input) => Boolean(input.muscleCode ?? input.grupoMuscular), {
    message: 'Indica el músculo entrenado o el grupo muscular.',
    path: ['muscleCode'],
  })
  .transform(({ nombre, grupoMuscular, descripcion, equipoIds, ...extendedData }) => ({
    name: nombre,
    // Se deja vacío cuando solo llega `muscleCode`: lo rellena el servicio con
    // el grupo real del músculo, que es más fiable que lo que se teclee aquí.
    muscleGroup: grupoMuscular ?? null,
    muscleCode: extendedData.muscleCode ?? null,
    equipmentLabel: extendedData.equipmentLabel ?? null,
    description: descripcion ?? null,
    equipmentIds: equipoIds ?? [],
    bodyPart: extendedData.bodyPart ?? null,
    targetMuscle: extendedData.targetMuscle ?? null,
    synergistMuscleGroup: extendedData.synergistMuscleGroup ?? null,
    secondaryMuscles: extendedData.secondaryMuscles ?? [],
    instructions: extendedData.instructions ?? {},
    instructionSteps: extendedData.instructionSteps ?? {},
    metadata: extendedData.metadata ?? {},
  }));

/** Consulta de la máquina que corresponde a un músculo. */
export const equipmentSuggestionQuerySchema = z.object({
  muscle: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .max(60),
});

export const updateExerciseSchema = exerciseRequestSchema
  .partial()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Debe enviar al menos un campo para actualizar.',
  })
  .transform(
    ({ nombre, grupoMuscular, descripcion, equipoIds, ...extendedData }) => ({
      ...(nombre !== undefined ? { name: nombre } : {}),
      ...(grupoMuscular !== undefined ? { muscleGroup: grupoMuscular } : {}),
      ...(descripcion !== undefined ? { description: descripcion } : {}),
      ...(equipoIds !== undefined ? { equipmentIds: equipoIds } : {}),
      ...(extendedData.bodyPart !== undefined
        ? { bodyPart: extendedData.bodyPart }
        : {}),
      ...(extendedData.targetMuscle !== undefined
        ? { targetMuscle: extendedData.targetMuscle }
        : {}),
      ...(extendedData.synergistMuscleGroup !== undefined
        ? { synergistMuscleGroup: extendedData.synergistMuscleGroup }
        : {}),
      ...(extendedData.secondaryMuscles !== undefined
        ? { secondaryMuscles: extendedData.secondaryMuscles }
        : {}),
      ...(extendedData.instructions !== undefined
        ? { instructions: extendedData.instructions }
        : {}),
      ...(extendedData.instructionSteps !== undefined
        ? { instructionSteps: extendedData.instructionSteps }
        : {}),
      ...(extendedData.metadata !== undefined
        ? { metadata: extendedData.metadata }
        : {}),
    }),
  );

export const exerciseFilterSchema = z
  .object({
    grupoMuscular: z.string().trim().max(100).optional(),
    equipoId: z.string().uuid().optional(),
    search: z.string().trim().min(1).max(120).optional(),
    bodyPart: z.string().trim().max(100).optional(),
    targetMuscle: z.string().trim().max(120).optional(),
    dataSource: z.nativeEnum(ExerciseDataSource).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .transform(({ grupoMuscular, equipoId, ...filters }) => ({
    ...filters,
    muscleGroup: grupoMuscular,
    equipmentId: equipoId,
  }));

const httpsUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => new URL(value).protocol === 'https:', {
    message: 'La URL debe usar HTTPS.',
  });

export const createExerciseMediaSchema = z
  .object({
    mediaType: z.nativeEnum(ExerciseMediaType),
    provider: z.nativeEnum(ExerciseMediaProvider),
    externalId: z.string().trim().min(1).max(180).optional().nullable(),
    url: httpsUrlSchema,
    thumbnailUrl: httpsUrlSchema.optional().nullable(),
    mimeType: z.string().trim().min(3).max(120).optional().nullable(),
    width: z.number().int().min(1).max(10000).optional().nullable(),
    height: z.number().int().min(1).max(10000).optional().nullable(),
    checksumSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional()
      .nullable(),
    altText: z.string().trim().min(3).max(500),
    attribution: z.string().trim().max(2000).optional().nullable(),
    license: z.string().trim().max(160).optional().nullable(),
    isPrimary: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(1000).default(0),
    metadata: metadataSchema.default({}),
  })
  .superRefine((input, context) => {
    if (input.mediaType === ExerciseMediaType.IMAGE && input.mimeType?.includes('video')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mimeType'],
        message: 'Una imagen no puede declarar un MIME de video.',
      });
    }
  });

export type CreateGlobalExerciseInput = z.infer<typeof createGlobalExerciseSchema>;
export type CreatePersonalExerciseInput = z.infer<typeof createPersonalExerciseSchema>;
export type UpdateExerciseInput = z.infer<typeof updateExerciseSchema>;
export type ExerciseFilterInput = z.infer<typeof exerciseFilterSchema>;
export type CreateExerciseMediaInput = z.infer<typeof createExerciseMediaSchema>;
export type EquipmentSuggestionQuery = z.infer<typeof equipmentSuggestionQuerySchema>;
