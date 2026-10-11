import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { Op } from "sequelize";
import {
  ExerciseDataSource,
  ExerciseMediaStatus,
  ExerciseStatus,
  ExerciseType,
} from "../../../common/enums/domain.enums";
import { ExerciseMediaModel } from "../exercise-media.model";
import { ExerciseModel } from "../exercise.model";
import {
  LibraryCreateEntry,
  LibraryManifest,
  libraryEntryVersion,
} from "./exercise-library-manifest";

/**
 * Acceso a la base de la carga de la biblioteca comprada.
 *
 * Los ejercicios nuevos se guardan como `data_source = CUSTOM` con
 * `external_id = bib:…`, no con un origen propio: el contrato que validan la
 * web y el móvil solo conoce CUSTOM y EXERCISES_DATASET, y un valor nuevo hacía
 * fallar el listado entero en las apps ya instaladas. CUSTOM es además lo que
 * son —catálogo curado a mano— y así heredan la unicidad de nombre de
 * `ux_ejercicios_global_nombre`. La procedencia queda en `metadata.library`,
 * `source_license` y `source_attribution`.
 */
@Injectable()
export class ExerciseLibraryRepository {
  constructor(
    @InjectModel(ExerciseModel)
    private readonly exerciseModel: typeof ExerciseModel,
    @InjectModel(ExerciseMediaModel)
    private readonly mediaModel: typeof ExerciseMediaModel,
  ) {}

  /** Ejercicios ya creados por una carga anterior de esta biblioteca, por clave. */
  async findCreated(keys: string[]): Promise<Map<string, ExerciseModel>> {
    if (keys.length === 0) return new Map();
    const rows = await this.exerciseModel.findAll({
      where: {
        dataSource: ExerciseDataSource.CUSTOM,
        externalId: { [Op.in]: keys },
      },
    });
    return new Map(rows.map((row) => [row.externalId ?? "", row]));
  }

  /** Destinos de los enlaces: ejercicios activos del catálogo importado. */
  async findLinkTargets(externalIds: string[]): Promise<Map<string, ExerciseModel>> {
    if (externalIds.length === 0) return new Map();
    const rows = await this.exerciseModel.findAll({
      where: {
        dataSource: ExerciseDataSource.EXERCISES_DATASET,
        externalId: { [Op.in]: externalIds },
        status: ExerciseStatus.ACTIVE,
        type: ExerciseType.GLOBAL,
      },
    });
    return new Map(rows.map((row) => [row.externalId ?? "", row]));
  }

  /**
   * Nombres de los ejercicios globales CUSTOM activos que no son de esta
   * biblioteca, normalizados como el índice único (`lower(btrim(nombre))`).
   */
  async findForeignCustomNames(keys: string[]): Promise<Set<string>> {
    const rows = await this.exerciseModel.findAll({
      attributes: ["name", "externalId"],
      where: {
        dataSource: ExerciseDataSource.CUSTOM,
        type: ExerciseType.GLOBAL,
        status: ExerciseStatus.ACTIVE,
        createdByUserId: null,
      },
    });
    const own = new Set(keys);
    return new Set(
      rows
        .filter((row) => !own.has(row.externalId ?? ""))
        .map((row) => row.name.trim().toLowerCase()),
    );
  }

  async countActiveMedia(exerciseIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (exerciseIds.length === 0) return counts;
    const rows = await this.mediaModel.findAll({
      attributes: ["exerciseId"],
      where: {
        exerciseId: { [Op.in]: exerciseIds },
        status: ExerciseMediaStatus.ACTIVE,
      },
    });
    for (const row of rows) {
      counts.set(row.exerciseId, (counts.get(row.exerciseId) ?? 0) + 1);
    }
    return counts;
  }

  listMedia(exerciseIds: string[]): Promise<ExerciseMediaModel[]> {
    if (exerciseIds.length === 0) return Promise.resolve([]);
    return this.mediaModel.findAll({
      where: { exerciseId: { [Op.in]: exerciseIds } },
    });
  }

  /**
   * C3.b: una entrada `LINK` trae el nombre en español (`names.es`) de un
   * ejercicio del dataset que está en inglés. Solo se escribe si cambia y nunca
   * se borra uno ya puesto con un valor vacío.
   */
  async setSpanishName(exercise: ExerciseModel, nameEs: string): Promise<boolean> {
    const value = nameEs.trim();
    if (value.length < 2 || value.length > 160 || exercise.nameEs === value) return false;
    await exercise.update({ nameEs: value });
    return true;
  }

  /** Crea o actualiza el ejercicio de una entrada `CREATE`. */
  async upsertExercise(
    entry: LibraryCreateEntry,
    manifest: Pick<LibraryManifest, "library" | "license" | "attribution">,
    existing: ExerciseModel | undefined,
  ): Promise<ExerciseModel> {
    const { exercise } = entry;
    const attributes = {
      name: exercise.name,
      nameEs: exercise.names.es,
      muscleGroup: exercise.muscleGroup,
      description: exercise.description,
      type: ExerciseType.GLOBAL,
      createdByUserId: null,
      status: ExerciseStatus.ACTIVE,
      dataSource: ExerciseDataSource.CUSTOM,
      externalId: entry.key,
      externalVersion: libraryEntryVersion(entry),
      sourceUrl: null,
      sourceLicense: manifest.license,
      sourceAttribution: manifest.attribution,
      category: exercise.bodyPart,
      bodyPart: exercise.bodyPart,
      requiredEquipment: exercise.requiredEquipment,
      targetMuscle: exercise.targetMuscle,
      synergistMuscleGroup: exercise.secondaryMuscles[0] ?? null,
      secondaryMuscles: exercise.secondaryMuscles,
      instructions: { es: exercise.instructionSteps.join(" ") },
      instructionSteps: { es: exercise.instructionSteps },
      metadata: {
        library: manifest.library,
        modality: exercise.modality,
        names: exercise.names,
        sources: entry.media.map((media) => media.source),
      },
      importedAt: new Date(),
    };
    if (existing) {
      return existing.update(attributes);
    }
    return this.exerciseModel.create(attributes);
  }
}
