import { BadRequestException, NotFoundException } from "@nestjs/common";
import { MediaStorageProvider } from "../media/media-storage.port";
import { StoriesRepository } from "./stories.repository";
import { StoriesService } from "./stories.service";

const userId = "00000000-0000-4000-8000-00000000000a";

function createService(
  repositoryOverrides: Partial<StoriesRepository>,
  mediaStorageOverrides: Partial<MediaStorageProvider> = {},
): StoriesService {
  return new StoriesService(repositoryOverrides as StoriesRepository, {
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
  } as unknown as MediaStorageProvider);
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

  it("removes the stored media and the story row", async () => {
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
});
