import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { MediaReferencesRepository } from "../media/media-references.repository";
import { MediaRetentionService } from "../media/media-retention.service";
import { MediaStorageProvider } from "../media/media-storage.port";
import { StoriesRepository } from "./stories.repository";
import { StoriesService } from "./stories.service";

const userId = "00000000-0000-4000-8000-00000000000a";
const transaction = { id: "tx" } as unknown as Transaction;

function createService(
  repositoryOverrides: Partial<StoriesRepository>,
  mediaStorageOverrides: Partial<MediaStorageProvider> = {},
  // ¿Queda otra fila (otra story, una foto de perfil, un mensaje…) apuntando
  // al mismo binario? Es lo que decide si el fichero se borra o se conserva.
  referencedElsewhere = false,
): StoriesService {
  const storage = {
    name: "local",
    upload: jest.fn().mockResolvedValue({
      provider: "local",
      key: "stories/some-key.jpg",
      url: "http://localhost:3000/media/stories/some-key.jpg",
      sizeBytes: 100,
      checksumSha256: "checksum",
      reused: false,
    }),
    remove: jest.fn(),
    ...mediaStorageOverrides,
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

  return new StoriesService(
    repositoryOverrides as StoriesRepository,
    storage,
    retention,
  );
}

describe("StoriesService.upload", () => {
  const file = { originalname: "story.jpg", mimetype: "image/jpeg", size: 1024, buffer: Buffer.from("x") };

  it("rejects an empty file", async () => {
    const service = createService({});
    await expect(service.upload(userId, "default", undefined)).rejects.toThrow(BadRequestException);
  });

  it("rejects a disallowed mime type", async () => {
    const service = createService({});
    await expect(
      service.upload(userId, "default", { ...file, mimetype: "application/zip" }),
    ).rejects.toThrow(BadRequestException);
  });

  it("infers media type from the mime type and stores the story", async () => {
    const create = jest.fn().mockResolvedValue({
      id: "story-1",
      mediaUrl: "http://localhost:3000/media/stories/some-key.jpg",
      mediaType: "image",
      createdAt: new Date("2026-08-28T00:00:00.000Z"),
      expiresAt: new Date("2026-08-29T00:00:00.000Z"),
    });
    const service = createService({ create });

    const result = await service.upload(userId, "default", file);

    expect(create).toHaveBeenCalledWith(userId, "default", expect.any(Object), "image");
    expect(result.mediaType).toBe("image");
  });
});

describe("StoriesService.view", () => {
  it("rejects viewing a story that does not exist", async () => {
    const service = createService({ findById: jest.fn().mockResolvedValue(null) });
    await expect(service.view("story-1", userId, "default")).rejects.toThrow(NotFoundException);
  });

  it("rejects viewing a story from a different tenant", async () => {
    const service = createService({
      findById: jest.fn().mockResolvedValue({ id: "story-1", tenantId: "other-gym" }),
    });
    await expect(service.view("story-1", userId, "default")).rejects.toThrow(NotFoundException);
  });

  it("records the view for a same-tenant story", async () => {
    const recordView = jest.fn().mockResolvedValue(undefined);
    const service = createService({
      findById: jest.fn().mockResolvedValue({ id: "story-1", tenantId: "default" }),
      recordView,
    });

    await service.view("story-1", userId, "default");

    expect(recordView).toHaveBeenCalledWith("story-1", userId);
  });
});

describe("StoriesService.remove", () => {
  it("rejects removing a story the caller does not own", async () => {
    const service = createService({ findByIdForUser: jest.fn().mockResolvedValue(null) });
    await expect(service.remove("story-1", userId)).rejects.toThrow(NotFoundException);
  });

  it("removes the stored media and the story row when nothing else references the file", async () => {
    const destroy = jest.fn().mockResolvedValue(undefined);
    const remove = jest.fn().mockResolvedValue(undefined);
    const service = createService(
      {
        findByIdForUser: jest.fn().mockResolvedValue({ storageKey: "stories/some-key.jpg", destroy }),
        delete: jest.fn().mockImplementation((story: { destroy: () => Promise<void> }) => story.destroy()),
      },
      { remove },
    );

    await expect(service.remove("story-1", userId)).resolves.toEqual({ deleted: true });
    expect(remove).toHaveBeenCalledWith("stories/some-key.jpg");
    expect(destroy).toHaveBeenCalled();
  });

  it("keeps the file when another row still references the same binary", async () => {
    // El nombre del fichero es el SHA-256 del contenido: si otra cuenta subió
    // el mismo binario comparten fichero, y borrar la story ajena le rompía la
    // foto. La fila propia cae igual; el fichero no.
    const destroy = jest.fn().mockResolvedValue(undefined);
    const remove = jest.fn().mockResolvedValue(undefined);
    const service = createService(
      {
        findByIdForUser: jest.fn().mockResolvedValue({ storageKey: "stories/shared-key.jpg", destroy }),
        delete: jest.fn().mockImplementation((story: { destroy: () => Promise<void> }) => story.destroy()),
      },
      { remove },
      true,
    );

    await expect(service.remove("story-1", userId)).resolves.toEqual({ deleted: true });
    expect(destroy).toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
