import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, join, resolve } from "path";
import {
  ExerciseMediaStatus,
  UserRole,
} from "../common/enums/domain.enums";
import { AuthenticatedUser } from "../common/types/auth-context.types";
import { env } from "../config/env";
import {
  buildExerciseMediaAltText,
  buildExerciseMediaExternalId,
} from "../modules/exercises/exercise-media-naming";
import { ExerciseMediaRepository } from "../modules/exercises/exercise-media.repository";
import {
  ExerciseMediaService,
  mediaProviderForStorage,
} from "../modules/exercises/exercise-media.service";
import { validateExerciseVideo } from "../modules/exercises/exercise-video-spec";
import { ExercisesRepository } from "../modules/exercises/exercises.repository";
import type { ExerciseMediaVariant } from "../modules/exercises/exercises.schemas";
import {
  MEDIA_STORAGE_PROVIDER,
  MediaStorageProvider,
} from "../modules/media/media-storage.port";
import { UsersRepository } from "../modules/users/users.repository";
import { ExerciseMediaUploadModule } from "./exercise-media-upload.module";

/**
 * Carga por lotes de las demostraciones de ejercicio (§6 del plan de vídeos).
 *
 * Producción deja los archivos en `entregas/<exerciseId>/`, y esto los sube al
 * almacenamiento configurado y crea las filas. Pasa por `ExerciseMediaService`,
 * no por SQL: la validación, el límite de medios activos y la invariante del
 * principal ya viven ahí.
 *
 *   yarn db:media:ejercicios --attribution="Estudio X"            # simulación
 *   yarn db:media:ejercicios --attribution="Estudio X" --apply    # carga real
 *
 * Seguro por defecto, como `db:media:mirror`: sin `--apply` solo informa.
 * Idempotente: una segunda pasada no cambia nada, porque compara el SHA-256 del
 * archivo con el que ya tiene registrada la fila.
 *
 * Nada se sube a medias: si una pieza del ejercicio no cumple la especificación
 * (§1), se salta el ejercicio entero. Media demostración es peor que ninguna —
 * el almacén es inmutable y el objeto sobrante no se puede borrar (ADR-0010).
 */

const logger = new Logger("ExerciseMediaUpload");

/** Estructura de la entrega, exactamente la del plan. */
const VARIANTS: ReadonlyArray<{
  variant: ExerciseMediaVariant;
  folderName: string;
  /** MP4 primero: es la fila principal de su variante. */
  sortOrder: { mp4: number; webm: number };
  isPrimary: boolean;
}> = [
  {
    variant: "HOMBRE",
    folderName: "hombre",
    sortOrder: { mp4: 0, webm: 1 },
    isPrimary: true,
  },
  {
    variant: "MUJER",
    folderName: "mujer",
    sortOrder: { mp4: 10, webm: 11 },
    isPrimary: false,
  },
];

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CommandOptions {
  apply: boolean;
  attribution: string;
  deliveriesRoot: string;
  renderVersion: number;
}

interface ExerciseOutcome {
  exerciseId: string;
  uploaded: number;
  reused: number;
  skipped: number;
  failed: number;
  reasons: string[];
}

/** `--flag=valor` o `--flag valor`, como el resto de comandos del repo. */
function readFlag(argv: readonly string[], name: string): string | undefined {
  const withEquals = argv.find((argument) => argument.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(name.length + 3);
  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--")) {
    return argv[index + 1];
  }
  return undefined;
}

export function parseCommandOptions(argv: readonly string[]): CommandOptions {
  const attribution = readFlag(argv, "attribution")?.trim();
  if (!attribution) {
    throw new Error(
      "Falta --attribution: el autor o estudio es obligatorio aunque el contenido sea propio.",
    );
  }
  const rawVersion = readFlag(argv, "render-version") ?? "1";
  const renderVersion = Number(rawVersion);
  if (!Number.isInteger(renderVersion) || renderVersion < 1) {
    throw new Error("--render-version debe ser un entero mayor o igual que 1.");
  }
  return {
    apply: argv.includes("--apply"),
    attribution,
    deliveriesRoot: readFlag(argv, "dir") ?? "entregas",
    renderVersion,
  };
}

/** ¿Está `ffprobe` disponible? Sin él no se puede garantizar la especificación. */
function hasFfprobe(): boolean {
  const probe = spawnSync("ffprobe", ["-version"], { encoding: "utf8" });
  return !probe.error && probe.status === 0;
}

function probeVideo(filePath: string): unknown {
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames",
      "-show_entries",
      "format=duration,size",
      "-of",
      "json",
      filePath,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  if (probe.status !== 0) {
    throw new Error(
      `ffprobe falló sobre ${basename(filePath)}: ${probe.stderr.trim()}`,
    );
  }
  return JSON.parse(probe.stdout) as unknown;
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

interface Piece {
  variant: ExerciseMediaVariant;
  filePath: string;
  mimeType: string;
  sortOrder: number;
  isPrimary: boolean;
}

/** Piezas presentes en la carpeta de un ejercicio, en orden de carga. */
function collectPieces(exerciseDirectory: string): {
  pieces: Piece[];
  posters: Map<ExerciseMediaVariant, string>;
} {
  const pieces: Piece[] = [];
  const posters = new Map<ExerciseMediaVariant, string>();

  for (const definition of VARIANTS) {
    const poster = join(
      exerciseDirectory,
      `${definition.folderName}-poster.webp`,
    );
    if (existsSync(poster)) posters.set(definition.variant, poster);

    for (const extension of [".mp4", ".webm"] as const) {
      const filePath = join(
        exerciseDirectory,
        `${definition.folderName}${extension}`,
      );
      if (!existsSync(filePath)) continue;
      pieces.push({
        variant: definition.variant,
        filePath,
        mimeType: MIME_BY_EXTENSION[extension],
        sortOrder:
          extension === ".mp4"
            ? definition.sortOrder.mp4
            : definition.sortOrder.webm,
        isPrimary: definition.isPrimary && extension === ".mp4",
      });
    }
  }
  return { pieces, posters };
}

async function processExercise(params: {
  exerciseId: string;
  directory: string;
  options: CommandOptions;
  actor: AuthenticatedUser;
  exercisesRepository: ExercisesRepository;
  mediaRepository: ExerciseMediaRepository;
  mediaService: ExerciseMediaService;
  storage: MediaStorageProvider;
}): Promise<ExerciseOutcome> {
  const {
    exerciseId,
    directory,
    options,
    actor,
    exercisesRepository,
    mediaRepository,
    mediaService,
    storage,
  } = params;
  const outcome: ExerciseOutcome = {
    exerciseId,
    uploaded: 0,
    reused: 0,
    skipped: 0,
    failed: 0,
    reasons: [],
  };

  if (!UUID_PATTERN.test(exerciseId)) {
    outcome.skipped += 1;
    outcome.reasons.push("El nombre de la carpeta no es un identificador válido.");
    return outcome;
  }

  const exercise = await exercisesRepository.findVisibleById(
    exerciseId,
    actor.id,
  );
  if (!exercise) {
    outcome.skipped += 1;
    outcome.reasons.push("El ejercicio no existe o no está activo.");
    return outcome;
  }

  const { pieces, posters } = collectPieces(directory);
  if (pieces.length === 0) {
    outcome.skipped += 1;
    outcome.reasons.push("La carpeta no contiene ningún vídeo.");
    return outcome;
  }

  // Validación previa de TODAS las piezas: el ejercicio se carga entero o no se
  // carga. Un fallo aquí no escribe ni un byte.
  for (const piece of pieces) {
    const report = probeVideo(piece.filePath);
    const check = validateExerciseVideo(report);
    if (!check.valid) {
      outcome.skipped += pieces.length;
      outcome.reasons.push(
        `${basename(piece.filePath)}: ${check.problems.join(" ")}`,
      );
      return outcome;
    }
    if (statSync(piece.filePath).size > env.EXERCISE_MEDIA_MAX_BYTES) {
      outcome.skipped += pieces.length;
      outcome.reasons.push(
        `${basename(piece.filePath)} supera ${env.EXERCISE_MEDIA_MAX_BYTES} bytes.`,
      );
      return outcome;
    }
  }

  const provider = mediaProviderForStorage(env.MEDIA_STORAGE_PROVIDER);
  const highlight = {
    target: exercise.targetMuscle,
    secondary: exercise.secondaryMuscles,
  };

  /**
   * El póster no ocupa fila (§5): se guarda en el almacén y su URL viaja en el
   * `thumbnailUrl` del vídeo, así que se sube por el puerto directamente.
   */
  const posterUrls = new Map<ExerciseMediaVariant, string>();
  for (const [variant, posterPath] of posters) {
    if (!options.apply) continue;
    const stored = await storage.upload(
      {
        originalName: basename(posterPath),
        mimeType: MIME_BY_EXTENSION[".webp"],
        sizeBytes: statSync(posterPath).size,
        buffer: readFileSync(posterPath),
      },
      { category: "ejercicios", exerciseId },
    );
    posterUrls.set(variant, stored.url);
  }

  for (const piece of pieces) {
    const externalId = buildExerciseMediaExternalId({
      exerciseId,
      variant: piece.variant,
      mimeType: piece.mimeType,
      renderVersion: options.renderVersion,
    });
    const checksum = sha256(piece.filePath);
    const existing = await mediaRepository.findByExternalIdentity(
      exerciseId,
      provider,
      externalId,
    );
    /**
     * Ya registrada con el mismo contenido: no se toca. La excepción es el
     * póster: si la entrega trae uno y la fila no lo tiene, hay que volver a
     * pasar por el servicio para colgárselo. Sin esta salvedad, añadir los
     * pósteres después de una primera carga no habría tenido ningún efecto y la
     * ficha se quedaba sin miniatura para siempre.
     */
    const posterPending =
      posters.has(piece.variant) && !existing?.thumbnailUrl;
    if (
      existing?.checksumSha256 === checksum &&
      existing.status === ExerciseMediaStatus.ACTIVE &&
      !posterPending
    ) {
      outcome.reused += 1;
      continue;
    }

    if (!options.apply) {
      outcome.uploaded += 1;
      continue;
    }

    try {
      await mediaService.uploadMedia(
        actor,
        exerciseId,
        {
          originalname: basename(piece.filePath),
          mimetype: piece.mimeType,
          size: statSync(piece.filePath).size,
          buffer: readFileSync(piece.filePath),
        },
        {
          altText: buildExerciseMediaAltText({
            name: exercise.name,
            requiredEquipment: exercise.requiredEquipment,
            targetMuscle: exercise.targetMuscle,
            variant: piece.variant,
          }),
          variant: piece.variant,
          thumbnailUrl: posterUrls.get(piece.variant) ?? null,
          renderVersion: options.renderVersion,
          attribution: options.attribution,
          license: "Propiedad de GymSheet",
          isPrimary: piece.isPrimary,
          sortOrder: piece.sortOrder,
          highlight,
          loop: true,
          reps: 2,
          durationMs: 6000,
          externalId,
        },
      );
      outcome.uploaded += 1;
    } catch (error: unknown) {
      outcome.failed += 1;
      outcome.reasons.push(
        `${basename(piece.filePath)}: ${error instanceof Error ? error.message : "error desconocido"}`,
      );
    }
  }

  return outcome;
}

async function run(): Promise<void> {
  const options = parseCommandOptions(process.argv.slice(2));
  const root = resolve(options.deliveriesRoot);

  if (!existsSync(root)) {
    logger.warn({
      event: "exercise.media.upload.no_deliveries",
      directory: root,
    });
    return;
  }
  if (options.apply && !hasFfprobe()) {
    throw new Error(
      "ffprobe no está disponible y sin él no se puede comprobar la especificación " +
        "de los vídeos. Instálalo (brew install ffmpeg) antes de usar --apply.",
    );
  }

  const application = await NestFactory.createApplicationContext(
    ExerciseMediaUploadModule,
    { logger: ["error", "warn", "log"] },
  );

  try {
    const usersRepository = application.get(UsersRepository);
    const administratorEmail = env.SEED_ADMIN_EMAIL;
    if (!administratorEmail) {
      throw new Error(
        "Falta SEED_ADMIN_EMAIL: el comando necesita saber con qué cuenta " +
          "administradora se registran las demostraciones.",
      );
    }
    const administrator =
      await usersRepository.findActiveByEmail(administratorEmail);
    if (!administrator || administrator.role !== UserRole.ADMIN) {
      throw new Error(
        `No hay un administrador activo con el correo ${administratorEmail}; ` +
          "el catálogo global solo lo puede gestionar un ADMIN.",
      );
    }
    const actor: AuthenticatedUser = {
      id: administrator.id,
      email: administrator.email,
      role: administrator.role,
      tenantId: administrator.tenantId ?? env.DEFAULT_TENANT_ID,
      tenantScope: administrator.tenantId ?? env.DEFAULT_TENANT_ID,
      impersonating: false,
    };

    const directories = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    if (directories.length === 0) {
      logger.log({
        event: "exercise.media.upload.nothing_to_do",
        directory: root,
      });
      return;
    }

    const outcomes: ExerciseOutcome[] = [];
    for (const exerciseId of directories) {
      const outcome = await processExercise({
        exerciseId,
        directory: join(root, exerciseId),
        options,
        actor,
        exercisesRepository: application.get(ExercisesRepository),
        mediaRepository: application.get(ExerciseMediaRepository),
        mediaService: application.get(ExerciseMediaService),
        storage: application.get<MediaStorageProvider>(MEDIA_STORAGE_PROVIDER),
      });
      outcomes.push(outcome);
      logger.log({ event: "exercise.media.upload.exercise", ...outcome });
    }

    const totals = outcomes.reduce(
      (accumulator, outcome) => ({
        uploaded: accumulator.uploaded + outcome.uploaded,
        reused: accumulator.reused + outcome.reused,
        skipped: accumulator.skipped + outcome.skipped,
        failed: accumulator.failed + outcome.failed,
      }),
      { uploaded: 0, reused: 0, skipped: 0, failed: 0 },
    );

    logger.log({
      event: options.apply
        ? "exercise.media.upload.completed"
        : "exercise.media.upload.dry_run",
      exercises: outcomes.length,
      ...totals,
    });

    if (totals.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await application.close();
  }
}

void run().catch((error: unknown) => {
  logger.error({
    event: "exercise.media.upload.command_failed",
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage: error instanceof Error ? error.message : "Unknown error",
  });
  process.exitCode = 1;
});
