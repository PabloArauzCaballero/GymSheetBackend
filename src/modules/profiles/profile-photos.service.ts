import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { env } from "../../config/env";
import { MediaRetentionService } from "../media/media-retention.service";
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from "../media/media-storage.port";
import { mapProfilePhotoToResponse, ProfilePhotoResponse } from "./profile-photo.mapper";
import { ProfilePhotosRepository } from "./profile-photos.repository";

/** Uploaded file shape, matching the FileInterceptor(memoryStorage) contract used elsewhere for media. */
export interface UploadedProfilePhoto {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

/**
 * Tope de la galería de un socio.
 *
 * Es una regla de producto (evitar que el perfil se vuelva un álbum sin
 * fondo), no una restricción de integridad — por eso vive aquí y no en una
 * columna o un CHECK de la migración.
 */
const MAX_PHOTOS_PER_USER = 6;

@Injectable()
export class ProfilePhotosService {
  constructor(
    private readonly repository: ProfilePhotosRepository,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
    private readonly retention: MediaRetentionService,
  ) {}

  async list(userId: string): Promise<ProfilePhotoResponse[]> {
    return (await this.repository.listByUser(userId)).map(mapProfilePhotoToResponse);
  }

  async upload(
    userId: string,
    file: UploadedProfilePhoto | undefined,
  ): Promise<ProfilePhotoResponse> {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException("Se requiere una imagen no vacía.");
    }
    if (file.size > env.MEDIA_UPLOAD_MAX_BYTES) {
      throw new BadRequestException(
        `La imagen excede el tamaño máximo de ${env.MEDIA_UPLOAD_MAX_BYTES} bytes.`,
      );
    }
    const mimeType = file.mimetype.toLowerCase();
    // Solo imágenes, aunque la configuración general de media admita video:
    // es una foto de perfil, no la mediateca de ejercicios.
    if (!mimeType.startsWith("image/")) {
      throw new BadRequestException("Solo se admiten imágenes.");
    }

    const existingCount = await this.repository.countByUser(userId);
    if (existingCount >= MAX_PHOTOS_PER_USER) {
      throw new BadRequestException(
        `No puedes tener más de ${MAX_PHOTOS_PER_USER} fotos de perfil. Elimina una para subir otra.`,
      );
    }

    const stored = await this.storage.upload({
      originalName: file.originalname,
      mimeType,
      sizeBytes: file.size,
      buffer: file.buffer,
    });

    const photo = await this.repository.create(userId, stored, existingCount);
    return mapProfilePhotoToResponse(photo);
  }

  async remove(userId: string, photoId: string): Promise<{ deleted: true }> {
    // La búsqueda ya está acotada al usuario: una foto ajena da 404, nunca
    // 403 — el acceso a un recurso de otra cuenta no debe confirmar que existe.
    const photo = await this.repository.findByIdForUser(photoId, userId);
    if (!photo) throw new NotFoundException("Foto no encontrada.");

    // La clave de almacenamiento es el SHA-256 del contenido, así que dos
    // cuentas que subieron la misma imagen comparten fichero. Borrarlo sin
    // mirar el refcount dejaría a la otra cuenta con la foto rota.
    await this.retention.deleteRowAndUnreferencedFile(
      photo.storageKey,
      (transaction) => this.repository.delete(photo, transaction),
    );
    return { deleted: true };
  }
}
