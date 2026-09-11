import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { env } from "../../config/env";
import { MediaRetentionService } from "../media/media-retention.service";
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from "../media/media-storage.port";
import {
  mapFeedRowsToResponse,
  mapStoryToResponse,
  mapStoryViewersToResponse,
  StoryFeedEntryResponse,
  StoryResponse,
  StoryViewersResponse,
} from "./stories.mapper";
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
    private readonly retention: MediaRetentionService,
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
    const rows = await this.repository.feedForConnections(viewerId, tenantId);
    return mapFeedRowsToResponse(rows);
  }

  /**
   * Marcar una story como vista exige **la misma regla que el feed**: o es
   * propia, o hay conexión `ACCEPTED`. Antes bastaba con que la story existiera
   * y fuera del mismo gimnasio, y eso abría una incoherencia real: quien no es
   * match no puede *ver* la story en su feed, pero conociendo o adivinando el
   * id sí podía registrarse como espectador y aparecer con nombre y foto en la
   * lista del autor.
   *
   * Quien no cumple recibe 404 y no 403: acceso horizontal no confirma que ese
   * id exista (regla del repo).
   */
  async view(storyId: string, viewerId: string, tenantId: string): Promise<{ recorded: true }> {
    const story = await this.repository.findById(storyId);
    if (!story || story.tenantId !== tenantId) throw new NotFoundException("Story no encontrada.");
    if (story.userId !== viewerId) {
      const isMatch = await this.repository.hasAcceptedConnection(viewerId, story.userId);
      if (!isMatch) throw new NotFoundException("Story no encontrada.");
    }
    await this.repository.recordView(storyId, viewerId);
    return { recorded: true };
  }

  /**
   * Quién vio mi story. Solo el autor: una story ajena responde 404 y no 403,
   * para no confirmar que ese id existe (acceso horizontal, regla del repo).
   */
  async viewers(storyId: string, ownerId: string, tenantId: string): Promise<StoryViewersResponse> {
    const story = await this.repository.findByIdForUser(storyId, ownerId);
    if (!story || story.tenantId !== tenantId) throw new NotFoundException("Story no encontrada.");
    const rows = await this.repository.viewersOf(storyId, tenantId);
    return mapStoryViewersToResponse(storyId, rows);
  }

  async remove(storyId: string, userId: string): Promise<{ deleted: true }> {
    const story = await this.repository.findByIdForUser(storyId, userId);
    // 404, no 403: una story ajena no debe confirmar que existe.
    if (!story) throw new NotFoundException("Story no encontrada.");
    // El fichero se comparte con quien haya subido el mismo binario (la clave
    // es el SHA-256 del contenido): la fila siempre cae, el fichero solo si
    // deja de estar referenciado. Ver `MediaRetentionService`.
    await this.retention.deleteRowAndUnreferencedFile(
      story.storageKey,
      (transaction) => this.repository.delete(story, transaction),
    );
    return { deleted: true };
  }
}
