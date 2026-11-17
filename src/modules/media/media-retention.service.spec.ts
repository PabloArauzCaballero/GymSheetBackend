import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { MediaReferencesRepository } from "./media-references.repository";
import { MediaRetentionService } from "./media-retention.service";
import { MediaStorageProvider } from "./media-storage.port";

const transaction = { id: "tx" } as unknown as Transaction;

/** Sequelize mínimo: ejecuta el callback con una transacción de mentira. */
function createSequelize(): Sequelize {
  return {
    transaction: jest.fn(
      async (run: (t: Transaction) => Promise<unknown>) => run(transaction),
    ),
  } as unknown as Sequelize;
}

function createService(options: {
  isReferenced: boolean;
  storageRemove?: jest.Mock;
  lockStorageKey?: jest.Mock;
  keepsKey?: boolean;
}) {
  const lockStorageKey =
    options.lockStorageKey ?? jest.fn().mockResolvedValue(undefined);
  const isReferenced = jest.fn().mockResolvedValue(options.isReferenced);
  const remove = options.storageRemove ?? jest.fn().mockResolvedValue(undefined);

  const service = new MediaRetentionService(
    createSequelize(),
    { lockStorageKey, isReferenced } as unknown as MediaReferencesRepository,
    {
      name: "local",
      canRemove: () => !(options.keepsKey ?? false),
      upload: jest.fn(),
      remove,
    } as unknown as MediaStorageProvider,
  );

  return { service, lockStorageKey, isReferenced, remove };
}

describe("MediaRetentionService.deleteRowAndUnreferencedFile", () => {
  it("keeps the file when another row still references the same storage key", async () => {
    const { service, remove, isReferenced } = createService({
      isReferenced: true,
    });
    const deleteOwnRow = jest.fn().mockResolvedValue(undefined);

    const result = await service.deleteRowAndUnreferencedFile(
      "sha256.jpg",
      deleteOwnRow,
    );

    expect(result).toEqual({ fileRemoved: false });
    // La fila propia SÍ se borra siempre; lo que se preserva es el binario.
    expect(deleteOwnRow).toHaveBeenCalledWith(transaction);
    expect(isReferenced).toHaveBeenCalledWith("sha256.jpg", transaction);
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes the file when the deleted row was the last reference", async () => {
    const { service, remove } = createService({ isReferenced: false });
    const deleteOwnRow = jest.fn().mockResolvedValue(undefined);

    const result = await service.deleteRowAndUnreferencedFile(
      "sha256.jpg",
      deleteOwnRow,
    );

    expect(result).toEqual({ fileRemoved: true });
    expect(deleteOwnRow).toHaveBeenCalledWith(transaction);
    expect(remove).toHaveBeenCalledWith("sha256.jpg");
  });

  /**
   * The catalog stays immutable (ADR-0010, ADR-0017): the row goes —the media
   * leaves the library— but the binary is kept. What matters is the SECOND
   * assertion: the service must not announce `fileRemoved: true` for a
   * removal the adapter is going to skip.
   */
  it("keeps the file of a key the storage does not delete, even with no references left", async () => {
    const { service, remove } = createService({
      isReferenced: false,
      keepsKey: true,
    });
    const deleteOwnRow = jest.fn().mockResolvedValue(undefined);

    const result = await service.deleteRowAndUnreferencedFile(
      "catalog/sha256.jpg",
      deleteOwnRow,
    );

    expect(deleteOwnRow).toHaveBeenCalledWith(transaction);
    expect(result).toEqual({ fileRemoved: false });
    expect(remove).not.toHaveBeenCalled();
  });

  /** A rejected removal is never reported as done: the caller must see it. */
  it("propagates a removal the storage rejects, after the row is gone", async () => {
    const denied = Object.assign(new Error("Access Denied."), { code: "AccessDenied" });
    const { service } = createService({
      isReferenced: false,
      storageRemove: jest.fn().mockRejectedValue(denied),
    });
    const deleteOwnRow = jest.fn().mockResolvedValue(undefined);

    await expect(
      service.deleteRowAndUnreferencedFile("users/u1/stories/sha256.jpg", deleteOwnRow),
    ).rejects.toBe(denied);
    expect(deleteOwnRow).toHaveBeenCalledWith(transaction);
  });

  it("counts references only after deleting its own row, inside one transaction", async () => {
    const order: string[] = [];
    const lockStorageKey = jest.fn(async () => {
      order.push("lock");
    });
    const { service, isReferenced } = createService({
      isReferenced: true,
      lockStorageKey,
    });
    isReferenced.mockImplementation(async () => {
      order.push("count");
      return true;
    });

    await service.deleteRowAndUnreferencedFile("sha256.jpg", async () => {
      order.push("delete");
    });

    // El bloqueo consultivo va primero: serializa dos borrados simultáneos del
    // mismo binario, que si no se leerían mutuamente como "aún referenciado".
    expect(order).toEqual(["lock", "delete", "count"]);
  });

  it("never removes the file when the transaction fails", async () => {
    const remove = jest.fn();
    const service = new MediaRetentionService(
      {
        transaction: jest.fn().mockRejectedValue(new Error("deadlock")),
      } as unknown as Sequelize,
      {} as unknown as MediaReferencesRepository,
      { name: "local", remove } as unknown as MediaStorageProvider,
    );

    await expect(
      service.deleteRowAndUnreferencedFile("sha256.jpg", jest.fn()),
    ).rejects.toThrow("deadlock");
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("MediaReferencesRepository.isReferenced", () => {
  function createRepository(referenced: boolean) {
    const query = jest.fn().mockResolvedValue([{ referenced }]);
    const repository = new MediaReferencesRepository({
      query,
    } as unknown as Sequelize);
    return { repository, query };
  }

  it("asks every table that stores media, by storage key or by public URL", async () => {
    const { repository, query } = createRepository(false);

    await expect(repository.isReferenced("sha256.jpg")).resolves.toBe(false);

    const [sql, options] = query.mock.calls[0] as [
      string,
      { replacements: Record<string, unknown> },
    ];
    for (const table of [
      "profile.stories",
      "profile.photos",
      "chat.messages",
      "media.files",
      "training.exercise_media",
      "facilities.branches",
    ]) {
      expect(sql).toContain(table);
    }
    expect(options.replacements).toMatchObject({
      storageKey: "sha256.jpg",
      urlSuffix: "/sha256.jpg",
      suffixLength: "/sha256.jpg".length,
    });
    // Sufijo exacto, no LIKE: la clave no puede colar comodines.
    expect(sql).not.toContain("LIKE");
  });

  it("reports a referenced key", async () => {
    const { repository } = createRepository(true);
    await expect(repository.isReferenced("sha256.jpg")).resolves.toBe(true);
  });

  it("takes a transaction-scoped advisory lock on the storage key", async () => {
    const query = jest.fn().mockResolvedValue([]);
    const repository = new MediaReferencesRepository({
      query,
    } as unknown as Sequelize);

    await repository.lockStorageKey("sha256.jpg", transaction);

    const [sql, options] = query.mock.calls[0] as [
      string,
      { replacements: Record<string, unknown>; transaction: Transaction },
    ];
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(options.replacements).toEqual({ storageKey: "sha256.jpg" });
    expect(options.transaction).toBe(transaction);
  });
});
