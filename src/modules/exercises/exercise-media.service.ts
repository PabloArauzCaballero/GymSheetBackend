import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import {
  ExerciseMediaProvider,
  ExerciseMediaStatus,
  ExerciseMediaType,
  ExerciseType,
  UserRole,
} from '../../common/enums/domain.enums';
import { env } from '../../config/env';
import {
  MEDIA_STORAGE_PROVIDER,
  MediaStorageProvider,
  MediaStorageProviderName,
  StoredAsset,
} from '../media/media-storage.port';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import {
  ExerciseMediaResponse,
  mapExerciseMediaToResponse,
} from './exercise.mapper';
import {
  buildExerciseMediaExternalId,
  isOwnStorageUrl,
  isStorableMediaUrl,
} from './exercise-media-naming';
import { ExerciseMediaModel } from './exercise-media.model';
import { ExerciseMediaRepository } from './exercise-media.repository';
import { ExerciseModel } from './exercise.model';
import { ExercisesRepository } from './exercises.repository';
import {
  CreateExerciseMediaInput,
  UploadExerciseMediaInput,
} from './exercises.schemas';

/** Archivo entrante de Multer (memoryStorage), igual que en fotos de perfil. */
export interface UploadedExerciseMedia {
  originalname: string;
  mimetype: string;
  size: number;
  buffer?: Buffer;
}

/** El tipo de media se deduce del MIME validado, no de lo que declare quien sube. */
export function mediaTypeForMime(mimeType: string): ExerciseMediaType {
  if (mimeType.startsWith('video/')) return ExerciseMediaType.VIDEO;
  if (mimeType === 'image/gif') return ExerciseMediaType.GIF;
  return ExerciseMediaType.IMAGE;
}

/** Proveedor del enum de dominio que corresponde al adaptador que guardó el archivo. */
export function mediaProviderForStorage(
  provider: MediaStorageProviderName,
): ExerciseMediaProvider {
  if (provider === 'cloudinary') return ExerciseMediaProvider.CLOUDINARY;
  if (provider === 'local') return ExerciseMediaProvider.LOCAL;
  // MinIO es S3 compatible y se persiste como tal: lo que importa a quien lee
  // es el protocolo del objeto, no qué servidor lo hospeda.
  return ExerciseMediaProvider.S3;
}

const MAX_ACTIVE_MEDIA_PER_EXERCISE = 10;

@Injectable()
export class ExerciseMediaService {
  constructor(
    private readonly exercisesRepository: ExercisesRepository,
    private readonly mediaRepository: ExerciseMediaRepository,
    private readonly sequelize: Sequelize,
    @Inject(MEDIA_STORAGE_PROVIDER)
    private readonly storage: MediaStorageProvider,
  ) {}

  async listMedia(
    authenticatedUser: AuthenticatedUser,
    exerciseId: string,
  ): Promise<ExerciseMediaResponse[]> {
    await this.findVisibleExerciseOrFail(exerciseId, authenticatedUser.id);
    const mediaItems = await this.mediaRepository.listActiveByExercise(exerciseId);
    return mediaItems.map(mapExerciseMediaToResponse);
  }

  async addMedia(
    authenticatedUser: AuthenticatedUser,
    exerciseId: string,
    input: CreateExerciseMediaInput,
  ): Promise<ExerciseMediaResponse> {
    const exercise = await this.findVisibleExerciseOrFail(exerciseId, authenticatedUser.id);
    this.assertCanManageMedia(authenticatedUser, exercise);

    const activeMediaCount = await this.mediaRepository.countActiveByExercise(exerciseId);

    if (activeMediaCount >= MAX_ACTIVE_MEDIA_PER_EXERCISE) {
      throw new ConflictException(
        `Un ejercicio no puede tener más de ${MAX_ACTIVE_MEDIA_PER_EXERCISE} archivos multimedia activos.`,
      );
    }

    const media = await this.persist(
      exerciseId,
      input,
      input.isPrimary || activeMediaCount === 0,
      authenticatedUser.id,
    );

    return mapExerciseMediaToResponse(media);
  }

  /**
   * Sube un archivo al almacenamiento configurado y lo asocia al ejercicio.
   *
   * Frente a `addMedia`, que registra una URL ajena, aquí el binario pasa a ser
   * nuestro: se guarda bajo `ejercicios/<id>/` en MinIO (o en el proveedor que
   * esté configurado) y la URL la produce el almacenamiento. Es lo que permite
   * servir las demostraciones desde el mismo sitio que el resto de la red
   * social, sin depender de que un origen externo siga en pie.
   *
   * El almacenamiento es idempotente por contenido: subir dos veces el mismo
   * archivo reutiliza el objeto en vez de duplicarlo.
   */
  async uploadMedia(
    authenticatedUser: AuthenticatedUser,
    exerciseId: string,
    file: UploadedExerciseMedia | undefined,
    input: UploadExerciseMediaInput,
  ): Promise<ExerciseMediaResponse> {
    const exercise = await this.findVisibleExerciseOrFail(
      exerciseId,
      authenticatedUser.id,
    );
    this.assertCanManageMedia(authenticatedUser, exercise);

    if (!file?.buffer || file.size === 0) {
      throw new BadRequestException('Se requiere un archivo no vacío.');
    }
    if (file.size > env.EXERCISE_MEDIA_MAX_BYTES) {
      throw new BadRequestException(
        `El archivo excede el tamaño máximo de ${env.EXERCISE_MEDIA_MAX_BYTES} bytes.`,
      );
    }
    const mimeType = file.mimetype.toLowerCase();
    if (!env.EXERCISE_MEDIA_ALLOWED_MIME.includes(mimeType)) {
      throw new BadRequestException(
        `Tipo de archivo no admitido: ${mimeType}.`,
      );
    }
    /**
     * El póster llega como URL porque se sube en su propia pieza, y eso abre la
     * puerta a apuntar la miniatura de una fila nuestra a un servidor ajeno: la
     * app la pediría en cada listado y ese tercero vería el tráfico de los
     * socios. Se exige que sea del almacenamiento propio. Se comprueba antes de
     * guardar el binario para no dejar un objeto huérfano en un almacén que no
     * borra nada (ADR-0010).
     */
    if (
      input.thumbnailUrl &&
      !isOwnStorageUrl(input.thumbnailUrl, env.MEDIA_STORAGE_PUBLIC_BASE_URL)
    ) {
      throw new BadRequestException(
        'El póster debe estar alojado en el almacenamiento propio.',
      );
    }
    // Ambas URLs, la del archivo y la del póster, tienen que poder guardarse.
    this.assertStorableUrl(this.predictableStorageUrl(exerciseId));
    if (input.thumbnailUrl) this.assertStorableUrl(input.thumbnailUrl);

    const stored = await this.storage.upload(
      {
        originalName: file.originalname,
        mimeType,
        sizeBytes: file.size,
        buffer: file.buffer,
      },
      { category: 'ejercicios', exerciseId },
    );

    const provider = mediaProviderForStorage(stored.provider);
    const variant = input.variant ?? 'NEUTRO';

    /**
     * Identidad natural de la pieza (§5 del plan de vídeos): ejercicio,
     * variante, formato y versión de render. No es la clave del objeto: esa es
     * el SHA-256 del contenido, así que recodificar el mismo plano produciría
     * una clave distinta y, sin esta identidad, una fila huérfana por reintento.
     */
    const conventionalExternalId =
      input.externalId ??
      buildExerciseMediaExternalId({
        exerciseId,
        variant,
        mimeType,
        renderVersion: input.renderVersion,
      });

    /**
     * Volver a subir el mismo archivo no es un error: el almacenamiento ya
     * reutiliza el objeto por contenido, así que aquí se reutiliza la fila.
     * Sin esto, repetir la subida chocaba contra la unicidad de
     * (ejercicio, proveedor, identificador) y salía un 500.
     */
    let existing = await this.mediaRepository.findByExternalIdentity(
      exerciseId,
      provider,
      conventionalExternalId,
    );
    /**
     * Compatibilidad con lo ya cargado: antes de existir la convención, la
     * identidad era la clave del objeto. Sin esta segunda búsqueda, la primera
     * recarga de una pieza antigua crearía una fila duplicada en vez de
     * actualizarla.
     */
    if (!existing && !input.externalId) {
      existing = await this.mediaRepository.findByExternalIdentity(
        exerciseId,
        provider,
        stored.key.slice(0, 180),
      );
    }
    if (existing) {
      const updated = await this.reactivate(existing, input, mimeType, stored);
      return mapExerciseMediaToResponse(updated);
    }

    const activeMediaCount =
      await this.mediaRepository.countActiveByExercise(exerciseId);
    if (activeMediaCount >= MAX_ACTIVE_MEDIA_PER_EXERCISE) {
      throw new ConflictException(
        `Un ejercicio no puede tener más de ${MAX_ACTIVE_MEDIA_PER_EXERCISE} archivos multimedia activos.`,
      );
    }

    const media = await this.persist(
      exerciseId,
      {
        mediaType: mediaTypeForMime(mimeType),
        provider,
        externalId: conventionalExternalId,
        url: stored.url,
        thumbnailUrl: input.thumbnailUrl ?? null,
        mimeType,
        width: null,
        height: null,
        checksumSha256: stored.checksumSha256,
        altText: input.altText,
        attribution: input.attribution ?? null,
        license: input.license ?? null,
        isPrimary: input.isPrimary,
        sortOrder: input.sortOrder,
        metadata: this.buildMetadata(input, stored, variant),
      },
      input.isPrimary || activeMediaCount === 0,
      authenticatedUser.id,
    );

    return mapExerciseMediaToResponse(media);
  }

  /**
   * Actualiza y reactiva una demostración ya asociada: mismo objeto, datos
   * nuevos. Cubre el caso de volver a subir el mismo archivo con otro texto
   * alternativo o para marcarlo como principal.
   */
  private reactivate(
    media: ExerciseMediaModel,
    input: UploadExerciseMediaInput,
    mimeType: string,
    stored: StoredAsset,
  ): Promise<ExerciseMediaModel> {
    return this.sequelize.transaction(async (transaction) => {
      const shouldBePrimary = input.isPrimary || media.isPrimary;
      if (shouldBePrimary) {
        await this.mediaRepository.clearPrimary(media.exerciseId, transaction);
        // `clearPrimary` acaba de poner el campo a false en la base, pero esta
        // instancia sigue creyendo que es principal y Sequelize solo persiste
        // lo que ve cambiado: sin sincronizarla, el `update` de abajo omitiría
        // `isPrimary` y el ejercicio se quedaría sin demostración principal.
        media.set("isPrimary", false);
      }
      const previous: Record<string, unknown> = media.metadata;
      const variant =
        input.variant ??
        ((previous.variant as UploadExerciseMediaInput['variant']) ?? 'NEUTRO');
      return media.update(
        {
          status: ExerciseMediaStatus.ACTIVE,
          mediaType: mediaTypeForMime(mimeType),
          mimeType,
          altText: input.altText,
          attribution: input.attribution ?? null,
          license: input.license ?? null,
          sortOrder: input.sortOrder,
          isPrimary: shouldBePrimary,
          // El póster solo se pisa si llega uno nuevo: una recarga sin póster no
          // debe dejar sin miniatura una fila que ya la tenía.
          thumbnailUrl: input.thumbnailUrl ?? media.thumbnailUrl,
          metadata: this.buildMetadata(input, stored, variant, previous),
        },
        { transaction },
      );
    });
  }

  /**
   * URL que va a producir el almacenamiento para este ejercicio. Sirve para
   * comprobar la restricción de la base ANTES de escribir el binario: el
   * adaptador compone `<base pública>/<clave>` y la clave empieza siempre por
   * `ejercicios/<id>/`.
   */
  private predictableStorageUrl(exerciseId: string): string {
    const base = env.MEDIA_STORAGE_PUBLIC_BASE_URL.replace(/\/+$/, '');
    return `${base}/ejercicios/${exerciseId}/objeto`;
  }

  /**
   * `training.exercise_media` tiene `ck_exercise_media_https`: la URL debe ser
   * HTTPS, o HTTP contra localhost/127.0.0.1. Con el almacén servido por HTTP
   * plano en un host público, el binario se escribía y el INSERT fallaba
   * después, dejando el objeto huérfano en un almacén inmutable y devolviendo
   * un 500 sin explicación.
   *
   * Es un fallo de configuración del servidor, no de quien sube: 503 y un
   * mensaje que nombre la variable a corregir.
   */
  private assertStorableUrl(url: string): void {
    if (isStorableMediaUrl(url)) return;
    throw new ServiceUnavailableException(
      'El almacenamiento de media no está configurado para guardar enlaces: ' +
        'MEDIA_STORAGE_PUBLIC_BASE_URL debe servirse por HTTPS (o por HTTP en ' +
        'localhost). Configura TLS delante del almacén antes de subir archivos.',
    );
  }

  /**
   * Metadatos de la pieza. Los campos opcionales solo se escriben si llegan:
   * una recarga que no los manda conserva lo que ya había en vez de borrarlo,
   * que es lo que permite corregir el texto alternativo sin perder la revisión
   * ni el resaltado ya registrados.
   */
  private buildMetadata(
    input: UploadExerciseMediaInput,
    stored: StoredAsset,
    variant: string,
    previous: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      ...previous,
      variant,
      renderVersion: input.renderVersion,
      ...(input.reps === undefined ? {} : { reps: input.reps }),
      ...(input.durationMs === undefined
        ? {}
        : { durationMs: input.durationMs }),
      ...(input.loop === undefined ? {} : { loop: input.loop }),
      ...(input.highlight === undefined ? {} : { highlight: input.highlight }),
      storageKey: stored.key,
      storageProvider: stored.provider,
      sizeBytes: stored.sizeBytes,
      reused: stored.reused,
    };
  }

  /** Inserta la fila y mantiene la invariante de que solo hay un principal. */
  private persist(
    exerciseId: string,
    input: CreateExerciseMediaInput,
    shouldBePrimary: boolean,
    createdByUserId: string,
  ) {
    return this.sequelize.transaction(async (transaction) => {
      if (shouldBePrimary) {
        await this.mediaRepository.clearPrimary(exerciseId, transaction);
      }

      return this.mediaRepository.create(
        {
          ...input,
          exerciseId,
          isPrimary: shouldBePrimary,
          createdByUserId,
        },
        transaction,
      );
    });
  }

  async removeMedia(
    authenticatedUser: AuthenticatedUser,
    mediaId: string,
  ): Promise<{ deleted: true }> {
    const media = await this.mediaRepository.findActiveById(mediaId);

    if (!media?.exercise) {
      throw new NotFoundException('Archivo multimedia no encontrado.');
    }

    this.assertCanManageMedia(authenticatedUser, media.exercise);

    await this.sequelize.transaction(async (transaction) => {
      const wasPrimary = media.isPrimary;
      await this.mediaRepository.markInactive(media, transaction);

      if (wasPrimary) {
        await this.mediaRepository.promoteFirstActive(media.exerciseId, transaction);
      }
    });

    return { deleted: true };
  }

  private async findVisibleExerciseOrFail(
    exerciseId: string,
    userId: string,
  ): Promise<ExerciseModel> {
    const exercise = await this.exercisesRepository.findVisibleById(exerciseId, userId);

    if (!exercise) {
      throw new NotFoundException('Ejercicio no encontrado o no visible para el usuario.');
    }

    return exercise;
  }

  private assertCanManageMedia(
    authenticatedUser: AuthenticatedUser,
    exercise: ExerciseModel,
  ): void {
    const canManageGlobal =
      exercise.type === ExerciseType.GLOBAL && authenticatedUser.role === UserRole.ADMIN;
    const canManagePersonal =
      exercise.type === ExerciseType.PERSONAL &&
      exercise.createdByUserId === authenticatedUser.id;

    if (!canManageGlobal && !canManagePersonal) {
      throw new ForbiddenException(
        'No tienes permisos para modificar los archivos multimedia de este ejercicio.',
      );
    }
  }
}
