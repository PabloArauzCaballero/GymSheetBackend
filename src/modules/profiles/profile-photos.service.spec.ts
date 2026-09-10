import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { MediaReferencesRepository } from "../media/media-references.repository";
import { MediaRetentionService } from "../media/media-retention.service";
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

function createService(
  repositoryOverrides: Partial<ProfilePhotosRepository>,
  storageOverrides: Partial<MediaStorageProvider> = {},
  // ¿Queda otra fila (otra foto, una story, un mensaje…) apuntando al mismo
  // binario? Decide si el fichero compartido se borra o se conserva.
  referencedElsewhere = false,
): ProfilePhotosService {
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
    ...storageOverrides,
  } as unknown as MediaStorageProvider;

  const retention = new MediaRetentionService(
    {
      transaction: jest.fn(
        async (run: (t: Transaction) => Promise<unknown>) => run(transaction),
      ),
    } as unknown as Sequelize,
    {
      lockStorageKey: jest.fn().mockResolvedValue(undefined),
      isReferenced: jest.fn().mockResolvedValue(referencedElsewhere),
    } as unknown as MediaReferencesRepository,
    storage,
  );

  return new ProfilePhotosService(
    repositoryOverrides as ProfilePhotosRepository,
    storage,
    retention,
  );
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
  it("reports a photo owned by another account as not found", async () => {
    const remove = jest.fn();
    const service = createService(
      { findByIdForUser: jest.fn().mockResolvedValue(null) },
      { remove },
    );

    await expect(service.remove(otherUserId, "photo-1")).rejects.toThrow(NotFoundException);
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes the stored asset and the row for the owner", async () => {
    const storageRemove = jest.fn().mockResolvedValue(undefined);
    const repositoryDelete = jest.fn().mockResolvedValue(undefined);
    const service = createService(
      {
        findByIdForUser: jest
          .fn()
          .mockResolvedValue({ id: "photo-1", userId, storageKey: "profile-photos/key.jpg" }),
        delete: repositoryDelete,
      },
      { remove: storageRemove },
    );

    await expect(service.remove(userId, "photo-1")).resolves.toEqual({ deleted: true });
    expect(storageRemove).toHaveBeenCalledWith("profile-photos/key.jpg");
    expect(repositoryDelete).toHaveBeenCalled();
  });

  it("deletes the row but keeps a file another row still references", async () => {
    // Dos cuentas que subieron la misma imagen comparten `storageKey`: borrar
    // el fichero al eliminar una de las filas rompía la foto de la otra.
    const storageRemove = jest.fn().mockResolvedValue(undefined);
    const repositoryDelete = jest.fn().mockResolvedValue(undefined);
    const service = createService(
      {
        findByIdForUser: jest
          .fn()
          .mockResolvedValue({ id: "photo-1", userId, storageKey: "shared-key.jpg" }),
        delete: repositoryDelete,
      },
      { remove: storageRemove },
      true,
    );

    await expect(service.remove(userId, "photo-1")).resolves.toEqual({ deleted: true });
    expect(repositoryDelete).toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
  });
});
