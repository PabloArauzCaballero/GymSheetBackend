import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { env } from "../../config/env";
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from "../media/media-storage.port";
import { mapFeedRowsToResponse, mapStoryToResponse, StoryFeedEntryResponse, StoryResponse } from "./stories.mapper";
import { StoriesRepository } from "./stories.repository";

export interface UploadedStoryMedia {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

@Injectable()
export class StoriesService {
  constructor(
    private readonly repository: StoriesRepository,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly mediaStorage: MediaStorageProvider,
  ) {}

  async upload(userId: string, tenantId: string, file: UploadedStoryMedia | undefined): Promise<StoryResponse> {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException("Se requiere una foto o video no vacío.");
    }
    if (file.size > env.CHAT_MEDIA_MAX_BYTES) {
      throw new BadRequestException(`El archivo excede el tamaño máximo de ${env.CHAT_MEDIA_MAX_BYTES} bytes.`);
    }
    const mimeType = file.mimetype.toLowerCase();
    if (!env.CHAT_MEDIA_ALLOWED_MIME.includes(mimeType)) {
      throw new BadRequestException("Tipo de archivo no admitido.");
    }
    const mediaType = mimeType.startsWith("video/") ? "video" : "image";

    const stored = await this.mediaStorage.upload({
      originalName: file.originalname,
      mimeType,
      sizeBytes: file.size,
      buffer: file.buffer,
    });

    const story = await this.repository.create(userId, tenantId, stored, mediaType);
    return mapStoryToResponse(story);
  }

  async feed(viewerId: string, tenantId: string): Promise<StoryFeedEntryResponse[]> {
    const rows = await this.repository.feedForTenant(viewerId, tenantId);
    return mapFeedRowsToResponse(rows);
  }

  async view(storyId: string, viewerId: string, tenantId: string): Promise<{ recorded: true }> {
    const story = await this.repository.findById(storyId);
    if (!story || story.tenantId !== tenantId) throw new NotFoundException("Story no encontrada.");
    await this.repository.recordView(storyId, viewerId);
    return { recorded: true };
  }

  async remove(storyId: string, userId: string): Promise<{ deleted: true }> {
    const story = await this.repository.findByIdForUser(storyId, userId);
    // 404, no 403: una story ajena no debe confirmar que existe.
    if (!story) throw new NotFoundException("Story no encontrada.");
    await this.mediaStorage.remove(story.storageKey);
    await this.repository.delete(story);
    return { deleted: true };
  }
}
