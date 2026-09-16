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

/**
 * Variante corporal de una demostración. El catálogo enseña la misma técnica en
 * cuerpo de hombre y de mujer, y la app elige según el perfil de quien mira;
 * `NEUTRO` es lo que no distingue (una lámina, un esquema).
 */
export const exerciseMediaVariants = ["HOMBRE", "MUJER", "NEUTRO"] as const;
export type ExerciseMediaVariant = (typeof exerciseMediaVariants)[number];

/** Un campo de formulario multiparte llega como texto; "true"/"1" es verdadero. */
const formBooleanSchema = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === "boolean" ? value : ["true", "1", "on"].includes(value.trim().toLowerCase()),
  );

/**
 * Datos que acompañan a un archivo subido. La URL no está: la pone el
 * almacenamiento, no quien sube, que es justo lo que evita registrar un enlace
 * a un origen ajeno como si fuera nuestro.
 */
/** Un objeto que viaja como campo de formulario llega serializado en texto. */
function parseJsonObjectField(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    // Se devuelve tal cual para que el esquema de destino emita el error de
    // tipo, que dice más que un «JSON inválido» genérico.
    return value;
  }
}

/**
 * Qué músculo resalta la pieza. Sale del catálogo (`target_muscle`,
 * `secondary_muscles`), no del criterio de quien anima: es lo que permite
 * comprobar en la revisión que el resaltado coincide con el ejercicio.
 */
const mediaHighlightSchema = z.preprocess(
  parseJsonObjectField,
  z.object({
    target: z.string().trim().max(120).nullable(),
    secondary: z.array(z.string().trim().max(120)).max(20).default([]),
  }),
);

export const uploadExerciseMediaSchema = z.object({
  altText: z.string().trim().min(3).max(500),
  /**
   * Póster del vídeo. Va como URL y no como archivo porque se sube antes, en su
   * propia pieza; el servicio exige que sea una URL de NUESTRO almacenamiento
   * para que una fila no pueda apuntar la miniatura a un servidor ajeno.
   */
  thumbnailUrl: z.string().trim().url().max(2048).optional().nullable(),
  /**
   * Versión del render. Forma parte de la identidad natural de la pieza, así
   * que subir una corrección con `renderVersion + 1` crea una fila nueva en vez
   * de pisar la que el socio ya vio.
   */
  renderVersion: z.coerce.number().int().min(1).max(999).default(1),
  reps: z.coerce.number().int().min(1).max(20).optional(),
  durationMs: z.coerce.number().int().min(1).max(600000).optional(),
  loop: formBooleanSchema.optional(),
  highlight: mediaHighlightSchema.optional(),
  /**
   * Opcional a propósito, sin valor por defecto: al volver a subir el mismo
   * archivo sin indicarla, omitirla debe conservar la variante que ya tenía.
   * Con un `default` no se distinguía «no la mando» de «ponla en NEUTRO», y
   * repetir una subida degradaba una demostración de mujer a neutra.
   */
  variant: z.enum(exerciseMediaVariants).optional(),
  attribution: z.string().trim().max(2000).optional().nullable(),
  license: z.string().trim().max(160).optional().nullable(),
  isPrimary: formBooleanSchema.default(false),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  /** Identidad estable del asset en el proceso de producción, si la hay. */
  externalId: z.string().trim().min(1).max(180).optional().nullable(),
});

export type UploadExerciseMediaInput = z.infer<typeof uploadExerciseMediaSchema>;

export type EquipmentSuggestionQuery = z.infer<typeof equipmentSuggestionQuerySchema>;
