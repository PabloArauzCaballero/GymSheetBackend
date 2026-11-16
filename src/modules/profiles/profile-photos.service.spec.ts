import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { MediaReferencesRepository } from "../media/media-references.repository";
import { MediaReferenceReleaseService } from "../media/media-reference-release.service";
import { MediaReleaseService } from "../media/media-release.service";
import { MediaStorageProvider } from "../media/media-storage.port";
import { ProfilePhotosRepository } from "./profile-photos.repository";
import { ProfilePhotosService, UploadedProfilePhoto } from "./profile-photos.service";

const userId = "00000000-0000-4000-8000-000000000001";
const otherUserId = "00000000-0000-4000-8000-000000000002";
const transaction = { id: "tx" } as unknown as Transaction;

function createImageFile(overrides: Partial<UploadedProfilePhoto> = {}): UploadedProfilePhoto {
  return {
    originalname: "photo.jpg",
    mimetype: "image/jpeg",
    size: 1024,
    buffer: Buffer.from("fake-image-bytes"),
    ...overrides,
  };
}

function createHarness(
  repositoryOverrides: Partial<ProfilePhotosRepository>,
  storageOverrides: Partial<MediaStorageProvider> = {},
  // ¿Queda otra fila (otra foto, una story, un mensaje…) apuntando al mismo
  // binario? Decide si el fichero compartido se libera o se conserva.
  referencedElsewhere = false,
) {
  const storage = {
    name: "local",
    upload: jest.fn().mockResolvedValue({
      provider: "local",
      key: "profile-photos/fake-key.jpg",
      url: "http://localhost/media/fake-key.jpg",
      sizeBytes: 1024,
      checksumSha256: "deadbeef",
      reused: false,
    }),
    remove: jest.fn().mockResolvedValue(undefined),
    canRemove: () => true,
    ...storageOverrides,
  } as unknown as MediaStorageProvider;
  const requestRelease = jest.fn().mockResolvedValue(undefined);
  const lockStorageKey = jest.fn().mockResolvedValue(undefined);

  const release = new MediaReferenceReleaseService(
    {
      transaction: jest.fn(
        async (run: (t: Transaction) => Promise<unknown>) => run(transaction),
      ),
    } as unknown as Sequelize,
    {
      lockStorageKey,
      isReferenced: jest.fn().mockResolvedValue(referencedElsewhere),
    } as unknown as MediaReferencesRepository,
    { requestRelease } as unknown as MediaReleaseService,
  );

  const service = new ProfilePhotosService(
    repositoryOverrides as ProfilePhotosRepository,
    storage,
    release,
  );
  return { service, requestRelease, lockStorageKey };
}

function createService(
  repositoryOverrides: Partial<ProfilePhotosRepository>,
): ProfilePhotosService {
  return createHarness(repositoryOverrides).service;
}

describe("ProfilePhotosService.upload", () => {
  it("rejects an empty file", async () => {
    const service = createService({ countByUser: jest.fn().mockResolvedValue(0) });

    await expect(
      service.upload(userId, createImageFile({ size: 0, buffer: Buffer.alloc(0) })),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects a non-image file", async () => {
    const service = createService({ countByUser: jest.fn().mockResolvedValue(0) });

    await expect(
      service.upload(userId, createImageFile({ mimetype: "video/mp4" })),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects a sixth photo when the account already has the maximum", async () => {
    const service = createService({ countByUser: jest.fn().mockResolvedValue(6) });

    await expect(service.upload(userId, createImageFile())).rejects.toThrow(BadRequestException);
  });

  it("stores the photo and persists it at the next position", async () => {
    const create = jest.fn().mockResolvedValue({
      id: "photo-1",
      userId,
      url: "http://localhost/media/fake-key.jpg",
      position: 2,
      createdAt: new Date("2026-08-25T00:00:00.000Z"),
    });
    const service = createService({
      countByUser: jest.fn().mockResolvedValue(2),
      create,
    });

    const result = await service.upload(userId, createImageFile());

    expect(create).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ url: "http://localhost/media/fake-key.jpg" }),
      2,
    );
    expect(result).toMatchObject({ id: "photo-1", posicion: 2 });
  });
});

describe("ProfilePhotosService.remove", () => {
  const ownPhoto = { id: "photo-1", userId, storageProvider: "local", storageKey: "users/u1/perfiles/key.jpg" };

  it("reports a photo owned by another account as not found", async () => {
    const remove = jest.fn();
    const { service, requestRelease } = createHarness(
      { findByIdForUser: jest.fn().mockResolvedValue(null) },
      { remove },
    );

    await expect(service.remove(otherUserId, "photo-1")).rejects.toThrow(NotFoundException);
    expect(remove).not.toHaveBeenCalled();
    expect(requestRelease).not.toHaveBeenCalled();
  });

  it("deletes the row and queues the file release in the same transaction, under the key lock", async () => {
    const storageRemove = jest.fn().mockResolvedValue(undefined);
    const repositoryDelete = jest.fn().mockResolvedValue(undefined);
    const { service, requestRelease, lockStorageKey } = createHarness(
      {
        findByIdForUser: jest.fn().mockResolvedValue(ownPhoto),
        delete: repositoryDelete,
        holdIfReported: jest.fn().mockResolvedValue(false),
      },
      { remove: storageRemove },
    );

    await expect(service.remove(userId, "photo-1")).resolves.toEqual({ deleted: true });
    expect(repositoryDelete).toHaveBeenCalledWith(ownPhoto, transaction);
    expect(lockStorageKey).toHaveBeenCalledWith(ownPhoto.storageKey, transaction);
    expect(requestRelease).toHaveBeenCalledWith(
      { aggregateType: "profile.photo", aggregateId: "photo-1", provider: "local", storageKey: ownPhoto.storageKey },
      transaction,
    );
    // The file is removed by the media.release worker, never inline.
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("answers success when the storage is failing: the removal is retried by the outbox, not lost", async () => {
    const storageRemove = jest.fn().mockRejectedValue(Object.assign(new Error("denied"), { code: "AccessDenied" }));
    const { service, requestRelease } = createHarness(
      {
        findByIdForUser: jest.fn().mockResolvedValue(ownPhoto),
        delete: jest.fn().mockResolvedValue(undefined),
        holdIfReported: jest.fn().mockResolvedValue(false),
      },
      { remove: storageRemove },
    );

    await expect(service.remove(userId, "photo-1")).resolves.toEqual({ deleted: true });
    expect(requestRelease).toHaveBeenCalledTimes(1);
  });

  it("deletes the row but keeps a file another row still references", async () => {
    // Dos cuentas que subieron la misma imagen comparten `storageKey`: borrar
    // el fichero al eliminar una de las filas rompía la foto de la otra.
    const repositoryDelete = jest.fn().mockResolvedValue(undefined);
    const { service, requestRelease } = createHarness(
      {
        findByIdForUser: jest.fn().mockResolvedValue({ ...ownPhoto, storageKey: "shared-key.jpg" }),
        delete: repositoryDelete,
        holdIfReported: jest.fn().mockResolvedValue(false),
      },
      {},
      true,
    );

    await expect(service.remove(userId, "photo-1")).resolves.toEqual({ deleted: true });
    expect(repositoryDelete).toHaveBeenCalled();
    expect(requestRelease).not.toHaveBeenCalled();
  });

  it("holds a photo under an open report instead of deleting it: the row stays, so its file does too", async () => {
    const repositoryDelete = jest.fn().mockResolvedValue(undefined);
    const holdIfReported = jest.fn().mockResolvedValue(true);
    const { service, requestRelease } = createHarness(
      {
        findByIdForUser: jest.fn().mockResolvedValue(ownPhoto),
        delete: repositoryDelete,
        holdIfReported,
      },
      {},
      // The held row itself still references the key.
      true,
    );

    await expect(service.remove(userId, "photo-1")).resolves.toEqual({ deleted: true });
    expect(holdIfReported).toHaveBeenCalledWith("photo-1", expect.anything());
    expect(repositoryDelete).not.toHaveBeenCalled();
    expect(requestRelease).not.toHaveBeenCalled();
  });
});
