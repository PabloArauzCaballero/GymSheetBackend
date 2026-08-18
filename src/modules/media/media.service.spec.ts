import { BadRequestException } from "@nestjs/common";
import { MediaFileModel } from "../membership/media-file.model";
import { MediaRepository } from "./media.repository";
import {
  MediaService,
  MediaUploadConfig,
  UploadedMultipartFile,
} from "./media.service";
import {
  MediaStorageProvider,
  StoredAsset,
} from "./media-storage.port";

function fakeStored(overrides: Partial<StoredAsset> = {}): StoredAsset {
  return {
    provider: "local",
    key: "deadbeef.jpg",
    url: "http://localhost:3000/media/deadbeef.jpg",
    sizeBytes: 3,
    checksumSha256: "deadbeef",
    reused: false,
    ...overrides,
  };
}

function fakeFile(
  overrides: Partial<UploadedMultipartFile> = {},
): UploadedMultipartFile {
  return {
    originalname: "cover.jpg",
    mimetype: "image/jpeg",
    size: 3,
    buffer: Buffer.from("abc"),
    ...overrides,
  };
}

const metadata = {
  code: "plan-basic-cover",
  name: "Portada",
  altText: "alt",
  license: "Propietaria",
  attribution: "GymSheet",
  width: undefined,
  height: undefined,
};

const config: MediaUploadConfig = {
  allowedMimeTypes: ["image/jpeg", "image/png", "image/gif"],
  maxBytes: 1000,
};

describe("MediaService", () => {
  let storage: jest.Mocked<MediaStorageProvider>;
  let repository: jest.Mocked<Pick<MediaRepository, "upsertByCode">>;
  let service: MediaService;

  beforeEach(() => {
    storage = {
      name: "local",
      upload: jest.fn().mockResolvedValue(fakeStored()),
      remove: jest.fn(),
    };
    repository = {
      upsertByCode: jest.fn().mockImplementation((values) =>
        Promise.resolve({
          id: "id-1",
          publicId: "pub-1",
          code: values.code,
          name: values.name,
          fileType: values.fileType,
          mimeType: values.mimeType,
          sourceType: "MANAGED",
          sourceName: values.provider,
          sourceUrl: values.url,
          storageUrl: values.url,
          altText: values.altText,
          width: values.width,
          height: values.height,
          license: values.license,
          attribution: values.attribution,
          status: "ACTIVE",
          createdAt: new Date(0),
          updatedAt: new Date(0),
        } as MediaFileModel),
      ),
    };
    service = new MediaService(
      storage,
      config,
      repository as unknown as MediaRepository,
    );
  });

  it("uploads via the provider and persists the mapped record", async () => {
    const result = await service.upload(fakeFile(), metadata);

    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "image/jpeg", sizeBytes: 3 }),
    );
    expect(repository.upsertByCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "plan-basic-cover",
        fileType: "IMAGE",
        url: "http://localhost:3000/media/deadbeef.jpg",
        provider: "local",
      }),
    );
    expect(result.archivo.url).toBe(
      "http://localhost:3000/media/deadbeef.jpg",
    );
    expect(result.almacenamiento.reutilizado).toBe(false);
  });

  it("rejects a missing/empty file", async () => {
    await expect(service.upload(undefined, metadata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.upload(fakeFile({ size: 0, buffer: Buffer.alloc(0) }), metadata),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("rejects a disallowed MIME type before touching storage", async () => {
    await expect(
      service.upload(fakeFile({ mimetype: "image/svg+xml" }), metadata),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("rejects a file larger than the configured maximum", async () => {
    await expect(
      service.upload(fakeFile({ size: 5000 }), metadata),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("classifies MIME into file_type (gif vs image vs document)", async () => {
    await service.upload(
      fakeFile({ mimetype: "image/gif" }),
      metadata,
    );
    expect(repository.upsertByCode).toHaveBeenCalledWith(
      expect.objectContaining({ fileType: "GIF" }),
    );
  });
});
