import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { Op, Transaction } from "sequelize";
import {
  ExerciseDataSource,
  ExerciseMediaProvider,
  ExerciseMediaStatus,
  ExerciseMediaType,
  ExerciseStatus,
  ExerciseType,
} from "../../../common/enums/domain.enums";
import { ExerciseMediaModel } from "../exercise-media.model";
import { ExerciseModel } from "../exercise.model";
import {
  ExternalExercise,
  OpenExerciseMediaRecord,
} from "./exercises-dataset.schemas";

export type ExternalExerciseImportContext = {
  sourceUrl: string;
  sourceVersion: string;
  contentSha256: string;
  fetchedAt: Date;
  mediaBaseUrl: string;
  importMedia: boolean;
};

export type UpsertExerciseResult = {
  exerciseId: string;
  created: boolean;
  mediaCreated: number;
  mediaUpdated: number;
};

@Injectable()
export class ExercisesDatasetRepository {
  constructor(
    @InjectModel(ExerciseModel)
    private readonly exerciseModel: typeof ExerciseModel,
    @InjectModel(ExerciseMediaModel)
    private readonly mediaModel: typeof ExerciseMediaModel,
  ) {}

  async deactivateMissingExercises(
    activeExternalIds: string[],
    transaction: Transaction,
  ): Promise<number> {
    if (activeExternalIds.length === 0) return 0;
    const [deactivated] = await this.exerciseModel.update(
      { status: ExerciseStatus.INACTIVE },
      {
        where: {
          dataSource: ExerciseDataSource.EXERCISES_DATASET,
          externalId: { [Op.notIn]: activeExternalIds },
          status: ExerciseStatus.ACTIVE,
        },
        transaction,
      },
    );
    return deactivated;
  }

  /**
   * Creates or updates one external exercise using its stable source identity.
   * `findOrCreate` uses a savepoint inside the caller transaction and safely
   * recovers when another importer inserts the same unique identity first.
   */
  async upsertExercise(
    record: ExternalExercise,
    context: ExternalExerciseImportContext,
    transaction: Transaction,
  ): Promise<UpsertExerciseResult> {
    const exerciseAttributes = this.toExerciseAttributes(record, context);
    const [exercise, created] = await this.exerciseModel.findOrCreate({
      where: {
        dataSource: ExerciseDataSource.EXERCISES_DATASET,
        externalId: record.id,
      },
      defaults: exerciseAttributes,
      transaction,
    });

    if (!created) {
      await exercise.update(exerciseAttributes, { transaction });
    }

    let mediaCreated = 0;
    let mediaUpdated = 0;

    if (context.importMedia) {
      const imageResult = await this.upsertMedia(
        exercise.id,
        record,
        context,
        ExerciseMediaType.IMAGE,
        record.image,
        true,
        transaction,
      );
      const gifResult = await this.upsertMedia(
        exercise.id,
        record,
        context,
        ExerciseMediaType.GIF,
        record.gif_url,
        false,
        transaction,
      );
      mediaCreated = Number(imageResult.created) + Number(gifResult.created);
      mediaUpdated = Number(!imageResult.created) + Number(!gifResult.created);
    }

    return {
      exerciseId: exercise.id,
      created,
      mediaCreated,
      mediaUpdated,
    };
  }

  async upsertOpenMedia(
    records: OpenExerciseMediaRecord[],
    mediaBaseUrl: string,
    transaction: Transaction,
  ): Promise<{ matched: number; created: number; updated: number; unchanged: number }> {
    const byName = new Map<string, OpenExerciseMediaRecord | null>();
    for (const record of records) {
      const key = normalizeExerciseName(record.name);
      byName.set(key, byName.has(key) ? null : record);
    }

    /**
     * Segundo índice, por conjunto de palabras **y** equipamiento.
     *
     * El primero exige el nombre idéntico carácter a carácter y solo casaba 134
     * de 1.324 ejercicios: los dos catálogos escriben lo mismo en otro orden
     * («Standing Barbell Calf Raise» y «barbell standing calf raise») o con
     * paréntesis. Comparando el conjunto de palabras sube a 165, y exigir
     * además el mismo equipamiento es lo que evita colgar la lámina de un
     * ejercicio con banda en uno con mancuerna. Una clave ambigua —dos
     * ejercicios distintos con las mismas palabras— se anula en vez de elegir
     * al azar.
     */
    const byTokens = new Map<string, OpenExerciseMediaRecord | null>();
    for (const record of records) {
      const equipment = normalizeEquipmentName(
        typeof record.equipment === "string" ? record.equipment : null,
      );
      const key = `${exerciseNameKey(record.name)}|${equipment}`;
      byTokens.set(key, byTokens.has(key) ? null : record);
    }

    const exercises = await this.exerciseModel.findAll({
      attributes: ["id", "name", "requiredEquipment"],
      where: { dataSource: ExerciseDataSource.EXERCISES_DATASET },
      transaction,
    });
    const primaryMedia = await this.mediaModel.findAll({
      attributes: ["exerciseId"],
      where: { isPrimary: true, status: ExerciseMediaStatus.ACTIVE },
      transaction,
    });
    const primaryMediaByExercise = new Map(
      primaryMedia.map((media) => [media.exerciseId, media.externalId]),
    );
    const counters = { matched: 0, created: 0, updated: 0, unchanged: 0 };

    for (const exercise of exercises) {
      const record =
        byName.get(normalizeExerciseName(exercise.name)) ??
        byTokens.get(
          `${exerciseNameKey(exercise.name)}|${normalizeEquipmentName(
            exercise.requiredEquipment,
          )}`,
        );
      if (!record) continue;
      const relativePath = record.images[0];
      const externalId = `free-exercise-db:${record.id}:0`.slice(0, 180);
      const currentPrimaryExternalId = primaryMediaByExercise.get(exercise.id);
      const isPrimary =
        !currentPrimaryExternalId || currentPrimaryExternalId === externalId;
      const attributes = {
        exerciseId: exercise.id,
        mediaType: ExerciseMediaType.IMAGE,
        provider: ExerciseMediaProvider.EXTERNAL_URL,
        externalId,
        url: new URL(relativePath, mediaBaseUrl).toString(),
        thumbnailUrl: null,
        mimeType: "image/jpeg",
        width: null,
        height: null,
        checksumSha256: null,
        altText: `${exercise.name} exercise demonstration`,
        attribution: "free-exercise-db contributors",
        license: "Unlicense (public domain)",
        isPrimary,
        sortOrder: isPrimary ? 0 : 50,
        status: ExerciseMediaStatus.ACTIVE,
        metadata: {
          source: "yuhonas/free-exercise-db",
          sourceExerciseId: record.id,
          sourcePath: relativePath,
        },
        createdByUserId: null,
      };
      const [media, created] = await this.mediaModel.findOrCreate({
        where: {
          exerciseId: exercise.id,
          provider: ExerciseMediaProvider.EXTERNAL_URL,
          externalId,
        },
        defaults: attributes,
        transaction,
      });
      const changed =
        !created &&
        (media.url !== attributes.url ||
          media.altText !== attributes.altText ||
          media.attribution !== attributes.attribution ||
          media.license !== attributes.license ||
          media.isPrimary !== attributes.isPrimary ||
          media.sortOrder !== attributes.sortOrder ||
          media.status !== attributes.status ||
          media.metadata?.sourcePath !== relativePath);
      if (changed) await media.update(attributes, { transaction });
      if (isPrimary) primaryMediaByExercise.set(exercise.id, externalId);
      counters.matched += 1;
      counters.created += Number(created);
      counters.updated += Number(changed);
      counters.unchanged += Number(!created && !changed);
    }

    return counters;
  }

  private toExerciseAttributes(
    record: ExternalExercise,
    context: ExternalExerciseImportContext,
  ): Record<string, unknown> {
    return {
      name: record.name,
      muscleGroup: record.muscle_group,
      description: record.instructions.es ?? record.instructions.en ?? null,
      type: ExerciseType.GLOBAL,
      createdByUserId: null,
      status: ExerciseStatus.ACTIVE,
      dataSource: ExerciseDataSource.EXERCISES_DATASET,
      externalId: record.id,
      externalVersion: context.sourceVersion,
      sourceUrl: context.sourceUrl,
      sourceLicense: "MIT data; media governed by separate Gym Visual terms",
      sourceAttribution: record.attribution,
      category: record.category,
      bodyPart: record.body_part,
      requiredEquipment: record.equipment,
      targetMuscle: record.target,
      synergistMuscleGroup: record.muscle_group,
      secondaryMuscles: record.secondary_muscles,
      instructions: record.instructions,
      instructionSteps: record.instruction_steps,
      metadata: {
        datasetCreatedAt: record.created_at,
        mediaId: record.media_id,
        contentSha256: context.contentSha256,
      },
      importedAt: context.fetchedAt,
    };
  }

  private async upsertMedia(
    exerciseId: string,
    record: ExternalExercise,
    context: ExternalExerciseImportContext,
    mediaType: ExerciseMediaType,
    relativePath: string,
    isPrimary: boolean,
    transaction: Transaction,
  ): Promise<{ created: boolean }> {
    const externalId = `${record.id}:${mediaType.toLowerCase()}`;
    const absoluteUrl = new URL(relativePath, context.mediaBaseUrl).toString();
    const mediaAttributes = {
      exerciseId,
      mediaType,
      provider: ExerciseMediaProvider.EXTERNAL_URL,
      externalId,
      url: absoluteUrl,
      thumbnailUrl:
        mediaType === ExerciseMediaType.GIF
          ? new URL(record.image, context.mediaBaseUrl).toString()
          : null,
      mimeType:
        mediaType === ExerciseMediaType.GIF ? "image/gif" : "image/jpeg",
      width: 180,
      height: 180,
      checksumSha256: null,
      altText: `${record.name} exercise demonstration`,
      attribution: record.attribution,
      license:
        "Gym Visual media terms; permission must be confirmed by deployer",
      isPrimary,
      sortOrder: isPrimary ? 0 : 1,
      status: ExerciseMediaStatus.ACTIVE,
      metadata: {
        sourcePath: relativePath,
        datasetMediaId: record.media_id,
        sourceVersion: context.sourceVersion,
      },
      createdByUserId: null,
    };
    const [media, created] = await this.mediaModel.findOrCreate({
      where: {
        exerciseId,
        provider: ExerciseMediaProvider.EXTERNAL_URL,
        externalId,
      },
      defaults: mediaAttributes,
      transaction,
    });

    if (!created) {
      await media.update(mediaAttributes, { transaction });
    }

    return { created };
  }
}

/**
 * Palabras que no distinguen un ejercicio de otro: se ignoran al comparar
 * nombres entre catálogos. «standing» y «seated» NO están aquí a propósito —
 * medido contra los catálogos reales, tolerarlas emparejaba «barbell standing
 * twist» con «Seated Barbell Twist», que es otro ejercicio.
 */
const NAME_STOP_WORDS = new Set([
  "with",
  "the",
  "on",
  "a",
  "an",
  "and",
  "of",
  "to",
  "in",
  "using",
]);

/** Sinónimos de catálogo que significan lo mismo escrito distinto. */
const NAME_SYNONYMS: Readonly<Record<string, string>> = {
  bodyweight: "body",
  db: "dumbbell",
  bb: "barbell",
};

/**
 * Conjunto de palabras significativas de un nombre de ejercicio.
 *
 * Ignora el orden, los plurales simples, la puntuación y lo que va entre
 * paréntesis —«(male)», «(v-bar)»—, que es donde los dos catálogos difieren sin
 * querer decir cosas distintas.
 */
export function exerciseNameTokens(value: string): ReadonlySet<string> {
  const plain = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)/g, " ");
  const tokens = new Set<string>();
  for (const raw of plain.split(/[^a-z0-9]+/)) {
    if (!raw || NAME_STOP_WORDS.has(raw)) continue;
    const synonym = NAME_SYNONYMS[raw] ?? raw;
    tokens.add(
      synonym.endsWith("s") && synonym.length > 3
        ? synonym.slice(0, -1)
        : synonym,
    );
  }
  return tokens;
}

/** Clave estable de un conjunto de palabras, para usarlo como índice. */
export function exerciseNameKey(value: string): string {
  return [...exerciseNameTokens(value)].sort().join(" ");
}

/**
 * Equipamiento normalizado a un vocabulario común. Los dos catálogos nombran lo
 * mismo de formas distintas («leverage machine» y «machine», «band» y «bands»),
 * y sin esta tabla el emparejamiento por equipo descartaría parejas correctas.
 */
const EQUIPMENT_ALIASES: Readonly<Record<string, string>> = {
  "body weight": "body only",
  "leverage machine": "machine",
  "smith machine": "machine",
  "sled machine": "machine",
  "olympic barbell": "barbell",
  "trap bar": "barbell",
  "ez barbell": "e-z curl bar",
  band: "bands",
  "resistance band": "bands",
  "stability ball": "exercise ball",
};

export function normalizeEquipmentName(value: string | null): string {
  const plain = (value ?? "").trim().toLowerCase();
  return EQUIPMENT_ALIASES[plain] ?? plain;
}

export function normalizeExerciseName(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}
