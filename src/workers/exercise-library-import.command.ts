import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { existsSync, readFileSync, statSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { ExerciseMediaStatus } from "../common/enums/domain.enums";
import { AuthenticatedUser } from "../common/types/auth-context.types";
import { env } from "../config/env";
import { buildExerciseMediaAltText } from "../modules/exercises/exercise-media-naming";
import {
  ExerciseMediaService,
  mediaProviderForStorage,
} from "../modules/exercises/exercise-media.service";
import {
  LIBRARY_VIDEO_PROFILE,
  validateExerciseVideo,
} from "../modules/exercises/exercise-video-spec";
import {
  LibraryImportState,
  LibraryManifest,
  MediaAction,
  libraryManifestSchema,
  mediaIdentity,
  planLibraryImport,
} from "../modules/exercises/import/exercise-library-manifest";
import { ExerciseLibraryRepository } from "../modules/exercises/import/exercise-library.repository";
import {
  MEDIA_STORAGE_PROVIDER,
  MediaStorageProvider,
} from "../modules/media/media-storage.port";
import { UsersRepository } from "../modules/users/users.repository";
import {
  hasFfprobe,
  probeVideo,
  readFlag,
  resolveAdministratorActor,
  sha256File,
} from "./exercise-media-command.shared";
import { ExerciseMediaUploadModule } from "./exercise-media-upload.module";

/**
 * Carga de una biblioteca de demostraciones comprada (plan de la biblioteca
 * 2026-10).
 *
 *   yarn db:import:biblioteca --manifest=entrega/manifiesto.json            # simulación
 *   yarn db:import:biblioteca --manifest=entrega/manifiesto.json --apply    # carga real
 *
 * El manifiesto dice, pieza a pieza, si crea un ejercicio nuevo o se cuelga de
 * uno del catálogo; las rutas de sus archivos son relativas a `--dir` (por
 * defecto, la carpeta del manifiesto).
 *
 * Todo o nada: se valida la entrega entera —esquema, SHA-256 de cada archivo,
 * ffprobe contra el perfil de la biblioteca, enlaces, nombres y límite de
 * medios— antes de escribir nada. El almacén no borra (ADR-0010), así que un
 * error descubierto a mitad de carga dejaría objetos huérfanos para siempre.
 *
 * Idempotente: una segunda pasada con la misma entrega no cambia nada.
 */

const logger = new Logger("ExerciseLibraryImport");

interface CommandOptions {
  apply: boolean;
  manifestPath: string;
  deliveryRoot: string;
}

export function parseLibraryImportOptions(
  argv: readonly string[],
): CommandOptions {
  const manifest = readFlag(argv, "manifest")?.trim();
  if (!manifest) {
    throw new Error("Falta --manifest con la ruta del manifiesto de la biblioteca.");
  }
  const manifestPath = resolve(manifest);
  return {
    apply: argv.includes("--apply"),
    manifestPath,
    deliveryRoot: resolve(readFlag(argv, "dir") ?? dirname(manifestPath)),
  };
}

function loadManifest(manifestPath: string): LibraryManifest {
  if (!existsSync(manifestPath)) {
    throw new Error(`No existe el manifiesto ${manifestPath}.`);
  }
  const parsed = libraryManifestSchema.safeParse(
    JSON.parse(readFileSync(manifestPath, "utf8")) as unknown,
  );
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 20)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`El manifiesto no es válido:\n${issues.join("\n")}`);
  }
  return parsed.data;
}

/** Comprueba en disco cada archivo de la entrega: existencia, huella, tamaño y vídeo. */
function inspectDelivery(
  manifest: LibraryManifest,
  root: string,
): Pick<LibraryImportState, "fileChecksums" | "fileSizes" | "videoProblems"> & {
  probedWith: "ffprobe" | "manifiesto";
} {
  const fileChecksums = new Map<string, string | null>();
  const fileSizes = new Map<string, number>();
  const videoProblems = new Map<string, string[]>();
  const ffprobe = hasFfprobe();

  for (const entry of manifest.entries) {
    for (const media of entry.media) {
      for (const file of [media.file, media.poster?.file].filter(
        (value): value is string => Boolean(value),
      )) {
        const absolute = join(root, file);
        if (!existsSync(absolute)) {
          fileChecksums.set(file, null);
          continue;
        }
        fileChecksums.set(file, sha256File(absolute));
        fileSizes.set(file, statSync(absolute).size);
      }

      if (media.kind !== "VIDEO") continue;
      const absolute = join(root, media.file);
      // Sin ffprobe (la imagen del servidor no lo trae) se valida el informe
      // del manifiesto, tomado al preparar la entrega; el SHA-256 de arriba
      // garantiza que describe este mismo archivo.
      const report =
        ffprobe && existsSync(absolute) ? probeVideo(absolute) : media.probe;
      if (report === null || report === undefined) {
        videoProblems.set(media.file, [
          "No hay ffprobe ni informe en el manifiesto: no se puede comprobar.",
        ]);
        continue;
      }
      const check = validateExerciseVideo(report, LIBRARY_VIDEO_PROFILE);
      if (!check.valid) videoProblems.set(media.file, check.problems);
    }
  }
  return {
    fileChecksums,
    fileSizes,
    videoProblems,
    probedWith: ffprobe ? "ffprobe" : "manifiesto",
  };
}

async function readDatabaseState(
  manifest: LibraryManifest,
  repository: ExerciseLibraryRepository,
): Promise<
  Pick<
    LibraryImportState,
    "createdExercises" | "linkTargets" | "foreignCustomNames" | "existingMedia"
  >
> {
  const createKeys = manifest.entries
    .filter((entry) => entry.decision === "CREATE")
    .map((entry) => entry.key);
  const linkIds = manifest.entries.flatMap((entry) =>
    entry.decision === "LINK" ? [entry.linkExternalId] : [],
  );

  const created = await repository.findCreated(createKeys);
  const targets = await repository.findLinkTargets(linkIds);
  const exerciseIds = [
    ...[...created.values()].map((row) => row.id),
    ...[...targets.values()].map((row) => row.id),
  ];
  const counts = await repository.countActiveMedia(exerciseIds);
  const provider = mediaProviderForStorage(env.MEDIA_STORAGE_PROVIDER);

  const existingMedia: LibraryImportState["existingMedia"] = new Map(
    (await repository.listMedia(exerciseIds))
      .filter((media) => media.provider === provider)
      .flatMap((media) => {
        const variant = media.metadata.variant;
        if (
          typeof variant !== "string" ||
          !["HOMBRE", "MUJER", "NEUTRO"].includes(variant) ||
          !media.mimeType
        ) {
          return [];
        }
        return [
          [
            mediaIdentity(
              media.exerciseId,
              variant as "HOMBRE" | "MUJER" | "NEUTRO",
              media.mimeType,
            ),
            {
              checksumSha256: media.checksumSha256,
              active: media.status === ExerciseMediaStatus.ACTIVE,
              hasThumbnail: Boolean(media.thumbnailUrl),
            },
          ] as const,
        ];
      }),
  );

  return {
    createdExercises: new Map(
      [...created].map(([key, row]) => [
        key,
        {
          id: row.id,
          externalVersion: row.externalVersion,
          activeMediaCount: counts.get(row.id) ?? 0,
        },
      ]),
    ),
    linkTargets: new Map(
      [...targets].map(([externalId, row]) => [
        externalId,
        { id: row.id, activeMediaCount: counts.get(row.id) ?? 0 },
      ]),
    ),
    foreignCustomNames: await repository.findForeignCustomNames(createKeys),
    existingMedia,
  };
}

/** Sube una pieza: primero el póster por el puerto, luego el medio por el servicio. */
async function uploadPiece(params: {
  action: MediaAction;
  exerciseId: string;
  exerciseName: string;
  requiredEquipment: string | null;
  targetMuscle: string | null;
  manifest: LibraryManifest;
  root: string;
  actor: AuthenticatedUser;
  mediaService: ExerciseMediaService;
  storage: MediaStorageProvider;
}): Promise<void> {
  const { action, exerciseId, manifest, root, actor } = params;
  const { media } = action;

  let thumbnailUrl: string | null = null;
  if (media.poster) {
    const posterPath = join(root, media.poster.file);
    const stored = await params.storage.upload(
      {
        originalName: basename(posterPath),
        mimeType: "image/webp",
        sizeBytes: statSync(posterPath).size,
        buffer: readFileSync(posterPath),
      },
      { category: "ejercicios", exerciseId },
    );
    thumbnailUrl = stored.url;
  }

  const filePath = join(root, media.file);
  await params.mediaService.uploadMedia(
    actor,
    exerciseId,
    {
      originalname: basename(filePath),
      mimetype: action.mimeType,
      size: statSync(filePath).size,
      buffer: readFileSync(filePath),
    },
    {
      altText: buildExerciseMediaAltText({
        name: params.exerciseName,
        requiredEquipment: params.requiredEquipment,
        targetMuscle: params.targetMuscle,
        variant: media.variant,
      }),
      variant: media.variant,
      thumbnailUrl,
      renderVersion: 1,
      attribution: manifest.attribution,
      license: manifest.license,
      isPrimary: action.isPrimary,
      sortOrder: action.sortOrder,
      ...(media.kind === "VIDEO"
        ? { loop: true, ...(media.durationMs ? { durationMs: media.durationMs } : {}) }
        : {}),
    },
    {
      library: manifest.library,
      brandingVisible: media.brandingVisible,
      source: media.source,
    },
  );
}

async function run(): Promise<void> {
  const options = parseLibraryImportOptions(process.argv.slice(2));
  const manifest = loadManifest(options.manifestPath);
  const delivery = inspectDelivery(manifest, options.deliveryRoot);

  const application = await NestFactory.createApplicationContext(
    ExerciseMediaUploadModule,
    { logger: ["error", "warn", "log"] },
  );

  try {
    const repository = application.get(ExerciseLibraryRepository);
    const plan = planLibraryImport(manifest, {
      ...delivery,
      maxBytes: env.EXERCISE_MEDIA_MAX_BYTES,
      ...(await readDatabaseState(manifest, repository)),
    });

    logger.log({
      event: "exercise.library.plan",
      library: manifest.library,
      entries: manifest.entries.length,
      probedWith: delivery.probedWith,
      problems: plan.problems.length,
      ...plan.counts,
    });

    if (plan.problems.length > 0) {
      for (const problem of plan.problems) {
        logger.error({ event: "exercise.library.problem", problem });
      }
      process.exitCode = 1;
      return;
    }
    if (!options.apply) {
      logger.log({ event: "exercise.library.dry_run" });
      return;
    }

    const actor = await resolveAdministratorActor(application.get(UsersRepository));
    const mediaService = application.get(ExerciseMediaService);
    const storage = application.get<MediaStorageProvider>(MEDIA_STORAGE_PROVIDER);
    const created = await repository.findCreated(
      manifest.entries.filter((entry) => entry.decision === "CREATE").map((entry) => entry.key),
    );
    const targets = await repository.findLinkTargets(
      manifest.entries.flatMap((entry) =>
        entry.decision === "LINK" ? [entry.linkExternalId] : [],
      ),
    );

    let failed = 0;
    let uploaded = 0;
    for (const entry of manifest.entries) {
      const action = plan.exercises.find((candidate) => candidate.key === entry.key);
      let exercise;
      if (entry.decision === "CREATE") {
        exercise =
          action?.type === "KEEP_EXERCISE"
            ? created.get(entry.key)
            : await repository.upsertExercise(entry, manifest, created.get(entry.key));
      } else {
        exercise = targets.get(entry.linkExternalId);
      }
      if (!exercise) {
        failed += 1;
        logger.error({ event: "exercise.library.missing_exercise", key: entry.key });
        continue;
      }

      for (const mediaAction of plan.media.filter(
        (candidate) => candidate.key === entry.key && candidate.type === "UPLOAD",
      )) {
        try {
          await uploadPiece({
            action: mediaAction,
            exerciseId: exercise.id,
            exerciseName: exercise.name,
            requiredEquipment: exercise.requiredEquipment,
            targetMuscle: exercise.targetMuscle,
            manifest,
            root: options.deliveryRoot,
            actor,
            mediaService,
            storage,
          });
          uploaded += 1;
        } catch (error: unknown) {
          failed += 1;
          logger.error({
            event: "exercise.library.upload_failed",
            key: entry.key,
            file: mediaAction.media.file,
            errorMessage: error instanceof Error ? error.message : "error desconocido",
          });
        }
      }
    }

    logger.log({ event: "exercise.library.completed", uploaded, failed });
    if (failed > 0) process.exitCode = 1;
  } finally {
    await application.close();
  }
}

void run().catch((error: unknown) => {
  logger.error({
    event: "exercise.library.command_failed",
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage: error instanceof Error ? error.message : "Unknown error",
  });
  process.exitCode = 1;
});
