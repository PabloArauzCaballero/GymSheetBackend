import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import { extname } from "path";
import { UniqueConstraintError } from "sequelize";
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
import { canViewStory } from "./story-audience.policy";
import type { StoryAudienceMode } from "./story-audience.policy";

export interface UploadedStoryMedia {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

export interface StoryUploadOptions {
  readonly audienceMode?: unknown;
  readonly recipientIds?: unknown;
  readonly requestId?: unknown;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

@Injectable()
export class StoriesService {
  constructor(
    private readonly repository: StoriesRepository,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly mediaStorage: MediaStorageProvider,
    private readonly retention: MediaRetentionService,
  ) {}

  async upload(
    userId: string,
    tenantId: string,
    file: UploadedStoryMedia | undefined,
    options: StoryUploadOptions = {},
  ): Promise<StoryResponse> {
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

    const requestId = this.parseUploadRequestId(options.requestId);
    const contentHash = requestId ? createHash("sha256").update(file.buffer).digest("hex") : null;
    if (requestId && contentHash) {
      const previous = await this.repository.findByUploadRequest(userId, requestId);
      if (previous) {
        if (previous.uploadContentHash !== contentHash) {
          throw new ConflictException("El requestId de subida ya se usó con otro archivo.");
        }
        return mapStoryToResponse(previous);
      }
    }

    const { audienceMode, recipientIds } = this.parseAudienceOptions(options);
    if (audienceMode === "SELECTED_CONNECTIONS") {
      const validRecipients = await this.repository.validAudienceRecipients(userId, recipientIds);
      if (validRecipients.length !== recipientIds.length) {
        throw new BadRequestException("La audiencia incluye personas sin una conexión aceptada vigente.");
      }
    }

    const stored = await this.mediaStorage.upload(
      {
        originalName: file.originalname,
        mimeType,
        sizeBytes: file.size,
        buffer: file.buffer,
      },
      { category: "stories", ownerUserId: userId },
    );

    try {
      const story = await this.repository.create(
        userId,
        tenantId,
        stored,
        mediaType,
        audienceMode,
        recipientIds,
        requestId && contentHash ? { requestId, contentHash } : undefined,
      );
      return mapStoryToResponse(story);
    } catch (error) {
      if (!(error instanceof UniqueConstraintError) || !requestId || !contentHash) throw error;

      // A concurrent upload may have won the unique (owner, requestId) insert.
      // Refcount-aware cleanup preserves the winner's shared asset, while
      // removing a distinct losing upload when no row references it.
      const previous = await this.repository.findByUploadRequest(userId, requestId);
      await this.retention.deleteRowAndUnreferencedFile(stored.key, async () => undefined);
      if (!previous) throw error;
      if (previous.uploadContentHash !== contentHash) {
        throw new ConflictException("El requestId de subida ya se usó con otro archivo.");
      }
      return mapStoryToResponse(previous);
    }
  }

  private parseUploadRequestId(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
      throw new BadRequestException("El requestId de subida debe ser un UUID válido.");
    }
    return value;
  }

  async feed(viewerId: string): Promise<StoryFeedEntryResponse[]> {
    const rows = await this.repository.feedForConnections(viewerId);
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
  async view(storyId: string, viewerId: string): Promise<{ recorded: true }> {
    await this.requireViewableStory(storyId, viewerId);
    await this.repository.recordView(storyId, viewerId);
    return { recorded: true };
  }

  async downloadMedia(storyId: string, viewerId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const story = await this.requireViewableStory(storyId, viewerId);
    return {
      buffer: await this.mediaStorage.download(story.storageKey),
      mimeType: mimeTypeForStorageKey(story.storageKey),
    };
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

  async requireViewableStory(storyId: string, actorId: string) {
    const story = await this.repository.findById(storyId);
    if (!story) throw new NotFoundException("Story no encontrada.");
    const isOwner = story.userId === actorId;
    const [hasAcceptedConnection, isSelectedRecipient, isBlocked] = isOwner
      ? [true, true, false]
      : await Promise.all([
          this.repository.hasAcceptedConnection(actorId, story.userId),
          story.audienceMode === "SELECTED_CONNECTIONS"
            ? this.repository.isSelectedRecipient(storyId, actorId)
            : Promise.resolve(false),
          this.repository.isBlockedEitherWay(actorId, story.userId),
        ]);
    if (!canViewStory(actorId, {
      authorId: story.userId,
      audienceMode: story.audienceMode ?? "ALL_CONNECTIONS",
      expiresAt: story.expiresAt,
      hiddenAt: story.hiddenAt,
      hasAcceptedConnection,
      isSelectedRecipient,
      isBlocked,
    })) {
      throw new NotFoundException("Story no encontrada.");
    }
    return story;
  }

  private parseAudienceOptions(options: StoryUploadOptions): {
    audienceMode: StoryAudienceMode;
    recipientIds: string[];
  } {
    const rawMode = options.audienceMode;
    const audienceMode = rawMode === undefined || rawMode === "" ? "ALL_CONNECTIONS" : rawMode;
    if (audienceMode !== "ALL_CONNECTIONS" && audienceMode !== "SELECTED_CONNECTIONS") {
      throw new BadRequestException("Modo de audiencia no válido.");
    }
    const rawRecipients = options.recipientIds;
    let recipientIds: unknown = rawRecipients ?? [];
    if (typeof recipientIds === "string") {
      try {
        recipientIds = JSON.parse(recipientIds) as unknown;
      } catch {
        throw new BadRequestException("La lista de audiencia debe ser JSON válido.");
      }
    }
    if (!Array.isArray(recipientIds) || recipientIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))) {
      throw new BadRequestException("La lista de audiencia debe contener UUID válidos.");
    }
    const ids = recipientIds as string[];
    if (new Set(ids).size !== ids.length || ids.length > 100) {
      throw new BadRequestException("La lista de audiencia contiene duplicados o excede el máximo de 100 personas.");
    }
    if (audienceMode === "ALL_CONNECTIONS" && ids.length > 0) {
      throw new BadRequestException("No se puede enviar una lista explícita con ALL_CONNECTIONS.");
    }
    return { audienceMode, recipientIds: ids };
  }
}

function mimeTypeForStorageKey(storageKey: string): string {
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  };
  return mimeTypes[extname(storageKey).toLowerCase()] ?? "application/octet-stream";
}
