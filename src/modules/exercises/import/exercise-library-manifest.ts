import { createHash } from "crypto";
import { z } from "zod";
import { exerciseMediaVariants } from "../exercises.schemas";
import type { ExerciseMediaVariant } from "../exercises.schemas";

/**
 * Manifiesto de una biblioteca de demostraciones comprada (plan de la
 * biblioteca 2026-10) y el plan de carga que se deriva de él.
 *
 * Todo lo de aquí es puro: el comando lee archivos, ffprobe y la base, y le pasa
 * a `planLibraryImport` lo que encontró. Decidir qué se crea, qué se reutiliza y
 * qué impide la carga vive en esta función para poder probarlo sin base de
 * datos ni almacén. El almacén no borra nada (ADR-0010): cada motivo de rechazo
 * que se detecta aquí es un objeto huérfano que no llega a existir.
 */

/** Vocabulario de `body_part`/`category` del catálogo; los filtros de la app lo usan. */
export const LIBRARY_BODY_PARTS = [
  "upper arms",
  "upper legs",
  "back",
  "waist",
  "chest",
  "shoulders",
  "lower legs",
  "lower arms",
  "cardio",
  "neck",
] as const;

/**
 * Vocabulario de `target_muscle`. Es el que reconoce el enriquecimiento de
 * músculos (`db:enrich:exercises`); un valor fuera de esta lista dejaría el
 * ejercicio sin filas en `training.exercise_muscles`.
 */
export const LIBRARY_TARGET_MUSCLES = [
  "abs",
  "pectorals",
  "biceps",
  "glutes",
  "delts",
  "triceps",
  "upper back",
  "lats",
  "calves",
  "quads",
  "forearms",
  "cardiovascular system",
  "hamstrings",
  "spine",
  "traps",
  "adductors",
  "serratus anterior",
  "abductors",
  "levator scapulae",
] as const;

export const LIBRARY_MODALITIES = [
  "fuerza-banda",
  "fuerza-peso-corporal",
  "fuerza-carga",
  "hiit-cardio",
  "pliometria",
  "boxeo",
  "agilidad",
  "core",
  "balon-medicinal",
  "gymstick",
  "estiramiento-estatico",
  "movilidad-dinamica",
  "liberacion-miofascial",
  "yoga",
  "manguito-rotador",
  "activacion",
] as const;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "SHA-256 en hexadecimal");
/** Ruta relativa a la carpeta de la entrega, sin salir de ella. */
const relativeFileSchema = z
  .string()
  .min(1)
  .refine(
    (value) => !value.startsWith("/") && !value.split("/").includes(".."),
    "La ruta debe ser relativa a la carpeta de la entrega.",
  );

const sourceSchema = z.object({
  folder: z.string().min(1),
  file: z.string().min(1),
  sha256: sha256Schema,
  segment: z
    .object({ start: z.number().min(0), end: z.number().positive() })
    .nullable()
    .default(null),
});

const mediaSchema = z
  .object({
    kind: z.enum(["VIDEO", "IMAGE"]),
    file: relativeFileSchema,
    sha256: sha256Schema,
    poster: z
      .object({ file: relativeFileSchema, sha256: sha256Schema })
      .nullable()
      .default(null),
    variant: z.enum(exerciseMediaVariants),
    durationMs: z.number().int().positive().nullable().default(null),
    brandingVisible: z.boolean().default(false),
    source: sourceSchema,
    /**
     * Informe de ffprobe tomado al preparar la entrega. La imagen del servidor
     * no trae ffmpeg; allí se valida este informe, que el SHA-256 ata al
     * archivo. Donde sí hay ffprobe, el comando vuelve a sondear el archivo.
     */
    probe: z.unknown().nullable().default(null),
  })
  .refine((media) => media.kind === "IMAGE" || media.poster !== null, {
    message: "Un vídeo necesita póster: sin él la lista reproduce el vídeo entero.",
  });

const exerciseSchema = z.object({
  name: z.string().trim().min(2).max(160),
  muscleGroup: z.string().trim().min(2).max(100),
  description: z.string().trim().min(10).max(2000),
  bodyPart: z.enum(LIBRARY_BODY_PARTS),
  requiredEquipment: z.string().trim().min(2).max(160),
  targetMuscle: z.enum(LIBRARY_TARGET_MUSCLES),
  secondaryMuscles: z.array(z.string().trim().min(2).max(120)).max(12),
  instructionSteps: z.array(z.string().trim().min(5).max(500)).min(2).max(8),
  names: z.object({
    es: z.string().trim().min(2),
    pt: z.string().trim().min(2),
    en: z.string().trim().min(2),
  }),
  modality: z.enum(LIBRARY_MODALITIES),
});

const entrySchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("CREATE"),
    /** Identidad estable del ejercicio: `external_id` con `data_source = CUSTOM`. */
    key: z
      .string()
      .regex(/^bib:[a-z-]+:[a-z0-9-]+$/, "Formato bib:<modalidad>:<slug>")
      .max(180),
    exercise: exerciseSchema,
    media: z.array(mediaSchema).min(1),
  }),
  z.object({
    decision: z.literal("LINK"),
    key: z.string().min(1).max(180),
    /** Ejercicio del catálogo importado al que se cuelga la demostración. */
    linkExternalId: z.string().min(1).max(180),
    names: z.object({ es: z.string(), pt: z.string(), en: z.string() }),
    media: z.array(mediaSchema).min(1),
  }),
]);

export const libraryManifestSchema = z.object({
  library: z.string().regex(/^[a-z0-9-]+$/).max(60),
  /** Va a `source_license` (máx. 120) y a la `license` de cada medio (máx. 160). */
  license: z.string().trim().min(3).max(120),
  attribution: z.string().trim().min(3).max(2000),
  entries: z.array(entrySchema).min(1),
});

export type LibraryManifest = z.infer<typeof libraryManifestSchema>;
export type LibraryEntry = LibraryManifest["entries"][number];
export type LibraryCreateEntry = Extract<LibraryEntry, { decision: "CREATE" }>;
export type LibraryMedia = LibraryEntry["media"][number];

/** Límite de medios activos por ejercicio, el mismo de `ExerciseMediaService`. */
export const MAX_ACTIVE_MEDIA_PER_EXERCISE = 10;

export const MIME_BY_MEDIA_EXTENSION: Readonly<Record<string, string>> = {
  ".mp4": "video/mp4",
  ".webp": "image/webp",
};

export function mimeTypeForLibraryFile(file: string): string | null {
  const dot = file.lastIndexOf(".");
  if (dot < 0) return null;
  return MIME_BY_MEDIA_EXTENSION[file.slice(dot).toLowerCase()] ?? null;
}

/**
 * Huella del contenido catalogado de un ejercicio. Va a `external_version`, y
 * es lo que hace que una segunda pasada no reescriba filas que no cambiaron.
 */
export function libraryEntryVersion(entry: LibraryCreateEntry): string {
  return createHash("sha256")
    .update(JSON.stringify(entry.exercise))
    .digest("hex");
}

/** Estado del mundo que el comando consulta y la planificación necesita. */
export interface LibraryImportState {
  /** Por archivo de la entrega: SHA-256 real, o nulo si no existe. */
  fileChecksums: ReadonlyMap<string, string | null>;
  /** Por vídeo de la entrega: motivos de rechazo de ffprobe (vacío = válido). */
  videoProblems: ReadonlyMap<string, readonly string[]>;
  /** Por archivo: tamaño en bytes. */
  fileSizes: ReadonlyMap<string, number>;
  maxBytes: number;
  /** Ejercicios ya creados por una carga anterior, por `key`. */
  createdExercises: ReadonlyMap<
    string,
    { id: string; externalVersion: string | null; activeMediaCount: number }
  >;
  /** Ejercicios del catálogo importado, por `linkExternalId`. */
  linkTargets: ReadonlyMap<string, { id: string; activeMediaCount: number }>;
  /**
   * Nombres (en minúscula y sin espacios en los bordes) de ejercicios globales
   * CUSTOM activos que NO son de esta biblioteca. Chocarían contra
   * `ux_ejercicios_global_nombre`.
   */
  foreignCustomNames: ReadonlySet<string>;
  /**
   * Medios ya registrados, por `<id del ejercicio>|<variante>|<mime>`:
   * checksum, si están activos y si tienen póster.
   */
  existingMedia: ReadonlyMap<
    string,
    { checksumSha256: string | null; active: boolean; hasThumbnail: boolean }
  >;
}

export type ExerciseAction =
  | { type: "CREATE_EXERCISE"; key: string }
  | { type: "UPDATE_EXERCISE"; key: string; exerciseId: string }
  | { type: "KEEP_EXERCISE"; key: string; exerciseId: string }
  | { type: "LINK_EXERCISE"; key: string; exerciseId: string };

export interface MediaAction {
  key: string;
  media: LibraryMedia;
  mimeType: string;
  /** `UPLOAD` sube y registra; `KEEP` ya está igual y no se toca. */
  type: "UPLOAD" | "KEEP";
  isPrimary: boolean;
  sortOrder: number;
}

export interface LibraryImportPlan {
  exercises: ExerciseAction[];
  media: MediaAction[];
  /** Si hay alguno, no se sube nada. */
  problems: string[];
  counts: {
    createExercises: number;
    updateExercises: number;
    keepExercises: number;
    linkExercises: number;
    uploadMedia: number;
    keepMedia: number;
  };
}

export function mediaIdentity(
  exerciseId: string,
  variant: ExerciseMediaVariant,
  mimeType: string,
): string {
  return `${exerciseId}|${variant}|${mimeType}`;
}

function normalizedName(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Orden de los medios de una entrada: primero los que no llevan marca ajena
 * visible, y entre ellos los vídeos. El primero se pide como principal; una
 * pieza con marca nunca desplaza a una limpia. Si es la única del ejercicio,
 * el servicio la hace principal igualmente: un ejercicio sin principal no
 * mostraría nada.
 */
function orderedMedia(media: readonly LibraryMedia[]): LibraryMedia[] {
  const rank = (item: LibraryMedia) =>
    (item.brandingVisible ? 2 : 0) + (item.kind === "VIDEO" ? 0 : 1);
  return [...media].sort((left, right) => rank(left) - rank(right));
}

export function planLibraryImport(
  manifest: LibraryManifest,
  state: LibraryImportState,
): LibraryImportPlan {
  const problems: string[] = [];
  const exercises: ExerciseAction[] = [];
  const mediaActions: MediaAction[] = [];

  const seenKeys = new Set<string>();
  const seenNames = new Map<string, string>();
  const seenLinkTargets = new Map<string, string>();

  for (const entry of manifest.entries) {
    if (seenKeys.has(entry.key)) {
      problems.push(`${entry.key}: la clave está repetida en el manifiesto.`);
      continue;
    }
    seenKeys.add(entry.key);

    // Una variante y un formato por ejercicio: es la identidad natural del
    // medio (gymsheet:<ejercicio>:<variante>:<formato>:v1), y dos piezas con la
    // misma acabarían pisándose una a otra.
    const slots = new Set<string>();
    for (const media of entry.media) {
      const mimeType = mimeTypeForLibraryFile(media.file);
      const slot = `${media.variant}|${mimeType}`;
      if (slots.has(slot)) {
        problems.push(
          `${entry.key}: dos piezas con la misma variante y formato (${media.variant}, ${mimeType}).`,
        );
      }
      slots.add(slot);
    }

    let exerciseId: string | null = null;
    let activeMediaCount = 0;

    if (entry.decision === "CREATE") {
      const name = normalizedName(entry.exercise.name);
      const previous = seenNames.get(name);
      if (previous) {
        problems.push(
          `${entry.key}: el nombre «${entry.exercise.name}» ya lo usa ${previous}.`,
        );
      }
      seenNames.set(name, entry.key);
      if (state.foreignCustomNames.has(name)) {
        problems.push(
          `${entry.key}: ya existe un ejercicio global con el nombre «${entry.exercise.name}».`,
        );
      }
      if (entry.exercise.names.es !== entry.exercise.name) {
        problems.push(`${entry.key}: names.es debe coincidir con el nombre.`);
      }

      const existing = state.createdExercises.get(entry.key);
      if (!existing) {
        exercises.push({ type: "CREATE_EXERCISE", key: entry.key });
      } else {
        exerciseId = existing.id;
        activeMediaCount = existing.activeMediaCount;
        exercises.push(
          existing.externalVersion === libraryEntryVersion(entry)
            ? { type: "KEEP_EXERCISE", key: entry.key, exerciseId: existing.id }
            : { type: "UPDATE_EXERCISE", key: entry.key, exerciseId: existing.id },
        );
      }
    } else {
      const target = state.linkTargets.get(entry.linkExternalId);
      if (!target) {
        problems.push(
          `${entry.key}: no existe el ejercicio ${entry.linkExternalId} del catálogo.`,
        );
        continue;
      }
      const previous = seenLinkTargets.get(entry.linkExternalId);
      if (previous) {
        problems.push(
          `${entry.key}: el ejercicio ${entry.linkExternalId} ya recibe la entrada ${previous}.`,
        );
      }
      seenLinkTargets.set(entry.linkExternalId, entry.key);
      exerciseId = target.id;
      activeMediaCount = target.activeMediaCount;
      exercises.push({ type: "LINK_EXERCISE", key: entry.key, exerciseId });
    }

    let newRows = 0;
    orderedMedia(entry.media).forEach((media, index) => {
      const mimeType = mimeTypeForLibraryFile(media.file);
      if (!mimeType) {
        problems.push(`${entry.key}: formato no admitido en ${media.file}.`);
        return;
      }
      if (media.kind === "VIDEO" && mimeType !== "video/mp4") {
        problems.push(`${entry.key}: el vídeo ${media.file} debe ser MP4.`);
      }
      if (media.kind === "IMAGE" && mimeType !== "image/webp") {
        problems.push(`${entry.key}: la imagen ${media.file} debe ser WebP.`);
      }

      const files = [
        { file: media.file, sha256: media.sha256 },
        ...(media.poster ? [media.poster] : []),
      ];
      for (const { file, sha256 } of files) {
        const actual = state.fileChecksums.get(file);
        if (actual === undefined || actual === null) {
          problems.push(`${entry.key}: falta el archivo ${file}.`);
        } else if (actual !== sha256) {
          problems.push(
            `${entry.key}: ${file} no es el archivo del manifiesto (SHA-256 distinto).`,
          );
        }
        const size = state.fileSizes.get(file);
        if (size !== undefined && size > state.maxBytes) {
          problems.push(`${entry.key}: ${file} supera ${state.maxBytes} bytes.`);
        }
      }
      if (media.kind === "VIDEO") {
        for (const problem of state.videoProblems.get(media.file) ?? []) {
          problems.push(`${entry.key}: ${media.file}: ${problem}`);
        }
      }

      const isPrimary = index === 0 && !media.brandingVisible;
      const sortOrder = index;
      const existing = exerciseId
        ? state.existingMedia.get(mediaIdentity(exerciseId, media.variant, mimeType))
        : undefined;
      const unchanged =
        existing !== undefined &&
        existing.active &&
        existing.checksumSha256 === media.sha256 &&
        (media.poster === null || existing.hasThumbnail);
      if (!existing || !existing.active) newRows += 1;
      mediaActions.push({
        key: entry.key,
        media,
        mimeType,
        type: unchanged ? "KEEP" : "UPLOAD",
        isPrimary,
        sortOrder,
      });
    });

    if (activeMediaCount + newRows > MAX_ACTIVE_MEDIA_PER_EXERCISE) {
      problems.push(
        `${entry.key}: superaría ${MAX_ACTIVE_MEDIA_PER_EXERCISE} medios activos (${activeMediaCount} + ${newRows}).`,
      );
    }
  }

  const count = (type: ExerciseAction["type"]) =>
    exercises.filter((action) => action.type === type).length;
  return {
    exercises,
    media: mediaActions,
    problems,
    counts: {
      createExercises: count("CREATE_EXERCISE"),
      updateExercises: count("UPDATE_EXERCISE"),
      keepExercises: count("KEEP_EXERCISE"),
      linkExercises: count("LINK_EXERCISE"),
      uploadMedia: mediaActions.filter((action) => action.type === "UPLOAD").length,
      keepMedia: mediaActions.filter((action) => action.type === "KEEP").length,
    },
  };
}
