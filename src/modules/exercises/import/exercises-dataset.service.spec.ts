import { Sequelize } from "sequelize-typescript";
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

  it("treats a previously imported identical snapshot as a catalog no-op", async () => {
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
