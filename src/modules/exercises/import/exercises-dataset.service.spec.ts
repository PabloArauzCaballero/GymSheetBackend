import { Sequelize } from "sequelize-typescript";
import { env } from "../../../config/env";
import { ExercisesDatasetClient } from "./exercises-dataset.client";
import { ExercisesDatasetRepository } from "./exercises-dataset.repository";
import { ExercisesDatasetService } from "./exercises-dataset.service";
import { ExternalExercise } from "./exercises-dataset.schemas";

describe("ExercisesDatasetService refresh status", () => {
  it("reads the last fully completed refresh from its PostgreSQL checkpoint", async () => {
    const refreshedAt = "2026-07-22T10:00:00.000Z";
    const sequelize = {
      query: jest
        .fn()
        .mockResolvedValue([
          { contentSha256: "a".repeat(64), recordCount: "1324", refreshedAt },
        ]),
    } as unknown as Sequelize;
    const service = new ExercisesDatasetService(
      {} as ExercisesDatasetClient,
      {} as ExercisesDatasetRepository,
      sequelize,
    );

    await expect(service.latestSuccessfulRefreshAt()).resolves.toEqual(
      new Date(refreshedAt),
    );
    expect(sequelize.query).toHaveBeenCalledWith(
      expect.stringContaining("exercise_dataset_sync_state"),
      expect.objectContaining({
        replacements: { sourceKey: "hasaneyldrm/exercises-dataset" },
      }),
    );
  });

  /**
   * Enciende el conector sólo durante este test.
   *
   * `importDataset` aborta con 503 si `EXERCISES_DATASET_ENABLED` es falso, y
   * ese es el valor por defecto tanto en el `.env` de desarrollo como en el
   * job de `hardening-ci.yml`, que lo fija a `"false"` explícitamente. El test
   * no verifica el interruptor, verifica qué hace el importador cuando el
   * snapshot no ha cambiado, así que la bandera es un prerrequisito del
   * escenario y no parte de lo que se prueba. Sin esto la suite estaba roja en
   * local **y en CI**, y el fallo se leía como un problema del importador.
   *
   * Se muta el objeto en vez de usar `jest.mock` porque el servicio lee
   * `env.EXERCISES_DATASET_ENABLED` en cada llamada, no al importar el módulo;
   * y se restaura después para no filtrar el estado a los otros dos tests, que
   * sí se apoyan en la configuración real.
   */
  it("treats a previously imported identical snapshot as a catalog no-op", async () => {
    const datasetEnabled = env.EXERCISES_DATASET_ENABLED;
    env.EXERCISES_DATASET_ENABLED = true;
    try {
    const fetchedAt = new Date("2026-07-22T12:00:00.000Z");
    const contentSha256 = "b".repeat(64);
    const records = Array.from({ length: 1000 }, (_, index) => ({
      id: String(index).padStart(4, "0"),
    })) as ExternalExercise[];
    const client = {
      fetchSnapshot: jest.fn().mockResolvedValue({
        records,
        sourceUrl:
          "https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/data/exercises.json",
        sourceVersion: "same-version",
        contentSha256,
        fetchedAt,
      }),
    } as unknown as ExercisesDatasetClient;
    const repository = {
      upsertExercise: jest.fn(),
      deactivateMissingExercises: jest.fn(),
    } as unknown as ExercisesDatasetRepository;
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          contentSha256,
          recordCount: records.length,
          refreshedAt: "2026-07-21T12:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([]);
    const sequelize = {
      query,
      transaction: jest.fn(),
    } as unknown as Sequelize;
    const service = new ExercisesDatasetService(client, repository, sequelize);

    await expect(
      service.importDataset({ dryRun: false, importMedia: false }),
    ).resolves.toMatchObject({
      unchangedSnapshot: true,
      totalRecords: 1000,
      createdExercises: 0,
      updatedExercises: 0,
      deactivatedExercises: 0,
      batchesProcessed: 0,
    });
    expect(repository.upsertExercise).not.toHaveBeenCalled();
    expect(repository.deactivateMissingExercises).not.toHaveBeenCalled();
    expect(sequelize.transaction).not.toHaveBeenCalled();
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("ON CONFLICT (source_key) DO UPDATE"),
      expect.objectContaining({
        replacements: expect.objectContaining({ contentSha256 }),
      }),
    );
    } finally {
      env.EXERCISES_DATASET_ENABLED = datasetEnabled;
    }
  });


  it("reports an empty cache as stale without contacting the external source", async () => {
    const sequelize = {
      query: jest.fn().mockResolvedValue([]),
    } as unknown as Sequelize;
    const client = {
      fetchSnapshot: jest.fn(),
    } as unknown as ExercisesDatasetClient;
    const service = new ExercisesDatasetService(
      client,
      {} as ExercisesDatasetRepository,
      sequelize,
    );

    await expect(service.getRefreshStatus()).resolves.toMatchObject({
      cache: "postgresql",
      lastSuccessfulRefreshAt: null,
      nextRefreshAt: null,
      stale: true,
    });
    expect(client.fetchSnapshot).not.toHaveBeenCalled();
  });
});
