import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { mapMediaFile } from "./media.mapper";
import { MediaUploadMetadata } from "./media.schemas";
import { MediaRepository } from "./media.repository";
import {
  MEDIA_STORAGE_PROVIDER,
  MediaStorageProvider,
} from "./media-storage.port";

/** Token e interfaz de configuración de validación de cargas. */
export const MEDIA_UPLOAD_CONFIG = Symbol("MEDIA_UPLOAD_CONFIG");
export interface MediaUploadConfig {
  readonly allowedMimeTypes: readonly string[];
  readonly maxBytes: number;
}

/** Forma mínima del archivo de Multer (memoryStorage), sin depender de @types/multer. */
export interface UploadedMultipartFile {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

function deriveFileType(mimeType: string): string {
  const value = mimeType.toLowerCase();
  if (value === "image/gif") return "GIF";
  if (value.startsWith("image/")) return "IMAGE";
  if (value.startsWith("video/")) return "VIDEO";
  return "DOCUMENT";
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @Inject(MEDIA_STORAGE_PROVIDER)
    private readonly storage: MediaStorageProvider,
    @Inject(MEDIA_UPLOAD_CONFIG)
    private readonly config: MediaUploadConfig,
    private readonly repository: MediaRepository,
  ) {}

  async upload(
    file: UploadedMultipartFile | undefined,
    metadata: MediaUploadMetadata,
  ) {
    if (!file || !file.buffer || file.size === 0)
      throw new BadRequestException("Se requiere un archivo no vacío.");
    if (file.size > this.config.maxBytes)
      throw new BadRequestException(
        `El archivo excede el tamaño máximo de ${this.config.maxBytes} bytes.`,
      );
    const mimeType = file.mimetype.toLowerCase();
    if (!this.config.allowedMimeTypes.includes(mimeType))
      throw new BadRequestException(
        `Tipo de archivo no permitido. Permitidos: ${this.config.allowedMimeTypes.join(", ")}.`,
      );

    const stored = await this.storage.upload({
      originalName: file.originalname,
      mimeType,
      sizeBytes: file.size,
      buffer: file.buffer,
    });

    const record = await this.repository.upsertByCode({
      code: metadata.code,
      name: metadata.name,
      fileType: deriveFileType(mimeType),
      mimeType,
      provider: stored.provider,
      url: stored.url,
      altText: metadata.altText,
      license: metadata.license,
      attribution: metadata.attribution,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
    });

    this.logger.log({
      event: "media.upload.completed",
      code: metadata.code,
      provider: stored.provider,
      reused: stored.reused,
      bytes: stored.sizeBytes,
    });

    return {
      archivo: mapMediaFile(record),
      almacenamiento: {
        proveedor: stored.provider,
        clave: stored.key,
        checksum: stored.checksumSha256,
        bytes: stored.sizeBytes,
        reutilizado: stored.reused,
      },
    };
  }
}
