import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "crypto";
import { UniqueConstraintError } from "sequelize";
import { env } from "../../config/env";
import {
  MEDIA_STORAGE_PROVIDER,
  MediaStorageProvider,
} from "../media/media-storage.port";
import {
  IsoBmffMetadataError,
  parseIsoBmffVideoMetadata,
} from "./iso-bmff-metadata";
import { ReelModel } from "./reel.model";
import type { UploadedReelMedia } from "./reels.controller";
import { mapReelToResponse } from "./reels.mapper";
import { ReelsRepository } from "./reels.repository";

const ALLOWED_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime"]);

@Injectable()
export class ReelsService {
  constructor(
    private readonly repository: ReelsRepository,
    @Inject(MEDIA_STORAGE_PROVIDER)
    private readonly storage: MediaStorageProvider,
  ) {}

  async upload(
    userId: string,
    tenantId: string,
    file: UploadedReelMedia | undefined,
    requestId?: string,
  ) {
    if (!file?.buffer || file.size === 0) {
      throw new BadRequestException(
        "Se requiere un video MP4 o QuickTime no vacío.",
      );
    }
    if (file.size > env.CHAT_MEDIA_MAX_BYTES) {
      throw new BadRequestException(
        `El archivo excede el tamaño máximo de ${env.CHAT_MEDIA_MAX_BYTES} bytes.`,
      );
    }
    const mimeType = file.mimetype.toLowerCase();
    if (!ALLOWED_VIDEO_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException("Solo se admiten videos MP4 o QuickTime.");
    }
    const validatedMimeType = mimeType as "video/mp4" | "video/quicktime";
    if (requestId !== undefined && !isUuid(requestId)) {
      throw new BadRequestException("requestId debe ser un UUID válido.");
    }

    let metadata;
    try {
      metadata = parseIsoBmffVideoMetadata(file.buffer);
    } catch (error) {
      if (error instanceof IsoBmffMetadataError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    if (requestId) {
      return this.retryIdempotentUpload({
        userId,
        tenantId,
        file,
        requestId,
        mimeType: validatedMimeType,
        durationSeconds: metadata.durationSeconds.toFixed(3),
      });
    }

    const stored = await this.storage.upload(
      {
        originalName: file.originalname,
        mimeType: validatedMimeType,
        sizeBytes: file.size,
        buffer: file.buffer,
      },
      { category: "reels", ownerUserId: userId },
    );

    const reel = await this.repository.create({
      userId,
      tenantId,
      storageProvider: stored.provider,
      storageKey: stored.key,
      mimeType: validatedMimeType,
      // The exact tick comparison happens in the parser. The persistence
      // model deliberately rounds only the public display value to 3 places.
      durationSeconds: metadata.durationSeconds.toFixed(3),
    });
    return mapReelToResponse(reel);
  }

  private async retryIdempotentUpload(input: {
    userId: string;
    tenantId: string;
    file: UploadedReelMedia;
    requestId: string;
    mimeType: "video/mp4" | "video/quicktime";
    durationSeconds: string;
  }) {
    const contentSha256 = createHash("sha256")
      .update(input.file.buffer)
      .digest("hex");
    const begin = () =>
      this.repository.beginIdempotentProcessing({
        userId: input.userId,
        tenantId: input.tenantId,
        storageProvider: this.storage.name,
        mimeType: input.mimeType,
        durationSeconds: input.durationSeconds,
        requestId: input.requestId,
        contentSha256,
      });

    let reel: ReelModel;
    try {
      reel = await begin();
    } catch (error: unknown) {
      // Another request may have won the unique-key race. Read its durable row
      // after the failed transaction and apply the same content comparison.
      if (!(error instanceof UniqueConstraintError)) throw error;
      reel = await begin();
    }

    if (reel.processingContentSha256 !== contentSha256) {
      throw new ConflictException(
        "requestId ya fue usado con un contenido distinto.",
      );
    }
    if (reel.status === "READY") return mapReelToResponse(reel);

    try {
      const stored = await this.storage.upload(
        {
          originalName: input.file.originalname,
          mimeType: input.mimeType,
          sizeBytes: input.file.size,
          buffer: input.file.buffer,
        },
        { category: "reels", ownerUserId: input.userId },
      );
      const ready = await this.repository.markProcessingReady(reel.id, {
        provider: stored.provider,
        key: stored.key,
        mimeType: input.mimeType,
        durationSeconds: input.durationSeconds,
      });
      return mapReelToResponse(ready);
    } catch (error: unknown) {
      try {
        await this.repository.markProcessingFailed(reel.id);
      } catch (stateError: unknown) {
        throw new AggregateError(
          [error, stateError],
          "Reel processing and failure persistence both failed.",
        );
      }
      throw error;
    }
  }

  async feed(userId: string) {
    const items = (await this.repository.feedForOwner(userId)).map(
      mapReelToResponse,
    );
    return { items, nextCursor: null } as const;
  }

  async downloadMedia(reelId: string, userId: string) {
    const reel = await this.repository.findReadyForOwner(reelId, userId);
    if (!reel) throw new NotFoundException("Reel no encontrado.");
    return {
      buffer: await this.storage.download(reel.storageKey),
      mimeType: reel.mimeType,
    };
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}
