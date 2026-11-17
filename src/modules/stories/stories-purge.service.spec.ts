import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { MediaReferencesRepository } from "../media/media-references.repository";
import { MediaReferenceReleaseService } from "../media/media-reference-release.service";
import { MediaReleaseService } from "../media/media-release.service";
import { StoriesPurgeService } from "./stories-purge.service";
import { StoriesRepository } from "./stories.repository";

const now = new Date("2026-09-08T12:00:00.000Z");
const transaction = { id: "tx" } as unknown as Transaction;

interface StoryRow {
  id: string;
  storageKey: string;
  expiresAt: Date;
}

/**
 * Repositorio en memoria: `findExpired` filtra de verdad por `expires_at`, de
 * modo que "solo se purga lo caducado" es una comprobación real y no la
 * tautología de devolver una lista ya filtrada por el propio test.
 */
function createRepository(rows: StoryRow[]) {
  const remaining = [...rows];
  const repository = {
    findExpired: jest.fn((at: Date, limit: number) =>
      Promise.resolve(
        remaining
          .filter((row) => row.expiresAt.getTime() <= at.getTime())
          .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
          .slice(0, limit)
          .map(({ id, storageKey }) => ({ id, storageProvider: "local", storageKey })),
      ),
    ),
    deleteById: jest.fn((id: string) => {
      const index = remaining.findIndex((row) => row.id === id);
      if (index < 0) return Promise.resolve(0);
      remaining.splice(index, 1);
      return Promise.resolve(1);
    }),
  };
  return { repository, remaining };
}

function createRelease(options: {
  referencedKeys?: readonly string[];
  requestRelease?: jest.Mock;
}) {
  const requestRelease = options.requestRelease ?? jest.fn().mockResolvedValue(undefined);
  const referenced = new Set(options.referencedKeys ?? []);
  const release = new MediaReferenceReleaseService(
    {
      transaction: jest.fn(
        async (run: (t: Transaction) => Promise<unknown>) => run(transaction),
      ),
    } as unknown as Sequelize,
    {
      lockStorageKey: jest.fn().mockResolvedValue(undefined),
      isReferenced: jest.fn((key: string) =>
        Promise.resolve(referenced.has(key)),
      ),
    } as unknown as MediaReferencesRepository,
    { requestRelease } as unknown as MediaReleaseService,
  );
  return { release, requestRelease };
}

/** Storage keys whose removal was queued on `media.release`. */
const queuedKeys = (requestRelease: jest.Mock): string[] =>
  requestRelease.mock.calls.map(([request]: [{ storageKey: string }]) => request.storageKey);

function createService(
  rows: StoryRow[],
  releaseOptions: Parameters<typeof createRelease>[0] = {},
) {
  const { repository, remaining } = createRepository(rows);
  const { release, requestRelease } = createRelease(releaseOptions);
  const service = new StoriesPurgeService(
    repository as unknown as StoriesRepository,
    release,
  );
  return { service, repository, remaining, requestRelease };
}

const expiredStory: StoryRow = {
  id: "expired-1",
  storageKey: "expired-1.jpg",
  expiresAt: new Date("2026-09-07T12:00:00.000Z"),
};
const activeStory: StoryRow = {
  id: "active-1",
  storageKey: "active-1.jpg",
  expiresAt: new Date("2026-09-09T12:00:00.000Z"),
};

describe("StoriesPurgeService.purgeExpired", () => {
  it("deletes only expired stories and queues the release of their files in the same transaction", async () => {
    const { service, repository, remaining, requestRelease } = createService([
      expiredStory,
      activeStory,
    ]);

    const result = await service.purgeExpired(50, now);

    expect(result).toEqual({
      examined: 1,
      deleted: 1,
      releasesQueued: 1,
      failed: 0,
    });
    expect(repository.deleteById).toHaveBeenCalledTimes(1);
    expect(repository.deleteById).toHaveBeenCalledWith(
      "expired-1",
      transaction,
    );
    expect(requestRelease).toHaveBeenCalledWith(
      { aggregateType: "story", aggregateId: "expired-1", provider: "local", storageKey: "expired-1.jpg" },
      transaction,
    );
    expect(queuedKeys(requestRelease)).not.toContain("active-1.jpg");
    expect(remaining).toEqual([activeStory]);
  });

  it("keeps the binary of an expired story that another row still references", async () => {
    const shared: StoryRow = {
      id: "expired-2",
      storageKey: "shared.jpg",
      expiresAt: new Date("2026-09-06T12:00:00.000Z"),
    };
    const { service, remaining, requestRelease } = createService(
      [shared, expiredStory, activeStory],
      { referencedKeys: ["shared.jpg"] },
    );

    const result = await service.purgeExpired(50, now);

    expect(result).toEqual({
      examined: 2,
      deleted: 2,
      releasesQueued: 1,
      failed: 0,
    });
    // La fila caducada cae siempre; el fichero compartido sobrevive.
    expect(queuedKeys(requestRelease)).toEqual(["expired-1.jpg"]);
    expect(remaining).toEqual([activeStory]);
  });

  it("is idempotent: a second pass finds nothing left to purge", async () => {
    const { service, requestRelease } = createService([expiredStory, activeStory]);

    await service.purgeExpired(50, now);
    const second = await service.purgeExpired(50, now);

    expect(second).toEqual({
      examined: 0,
      deleted: 0,
      releasesQueued: 0,
      failed: 0,
    });
    expect(requestRelease).toHaveBeenCalledTimes(1);
  });

  it("honours the batch size", async () => {
    const rows: StoryRow[] = Array.from({ length: 5 }, (_, index) => ({
      id: `expired-${index}`,
      storageKey: `expired-${index}.jpg`,
      expiresAt: new Date(`2026-09-0${index + 1}T00:00:00.000Z`),
    }));
    const { service } = createService(rows);

    const result = await service.purgeExpired(2, now);

    expect(result.examined).toBe(2);
    expect(result.deleted).toBe(2);
  });

  it("counts a story whose transaction fails and keeps purging the rest of the batch", async () => {
    const requestRelease = jest
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue(undefined);
    const other: StoryRow = {
      id: "expired-3",
      storageKey: "expired-3.jpg",
      expiresAt: new Date("2026-09-07T18:00:00.000Z"),
    };
    const { service } = createService([expiredStory, other], { requestRelease });

    const result = await service.purgeExpired(50, now);

    expect(result).toEqual({
      examined: 2,
      deleted: 1,
      releasesQueued: 1,
      failed: 1,
    });
  });
});
