import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { createHash } from 'crypto';
import {
  ExerciseDataSource,
  ExerciseMediaProvider,
  ExerciseMediaStatus,
  ExerciseMediaType,
} from '../../common/enums/domain.enums';
import { ExerciseMediaModel } from '../exercises/exercise-media.model';
import { ExerciseModel } from '../exercises/exercise.model';
import { HD_MIN_WIDTH, readJpegSize } from './hd-images';
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from './media-storage.port';
import { OpenStillsManifest } from './open-stills';

export interface OpenStillsResult {
  readonly total: number;
  readonly created: number;
  /** La fila existía con otro archivo. */
  readonly updated: number;
  readonly unchanged: number;
  /** El ejercicio no está en este catálogo (no es un error: otro entorno puede no tenerlo). */
  readonly sinEjercicio: number;
}

export type OpenStillReader = (archivo: string) => Buffer;

/**
 * Cuelga de cada ejercicio la lámina libre que le corresponde según la tabla
 * revisada a mano.
 *
 * Todo o nada en la validación: SHA-256, JPEG legible, ancho nítido y que el
 * ejercicio se llame como dice la tabla (un `external_id` reutilizado por otro
 * ejercicio no recibe una foto ajena). El almacén no borra, así que una entrega
 * a medias dejaría objetos huérfanos.
 *
 * No desplaza nada: si el ejercicio ya tiene un medio principal (su vídeo), la
 * lámina entra como secundaria y es la que usan portadas y miniaturas.
 * Idempotente por (ejercicio, external_id de la lámina) y SHA-256.
 */
@Injectable()
export class OpenStillsService {
  private readonly logger = new Logger(OpenStillsService.name);

  constructor(
    @InjectModel(ExerciseModel) private readonly exercises: typeof ExerciseModel,
    @InjectModel(ExerciseMediaModel) private readonly media: typeof ExerciseMediaModel,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
  ) {}

  async apply(manifest: OpenStillsManifest, read: OpenStillReader, { apply }: { apply: boolean }): Promise<OpenStillsResult> {
    const files = manifest.laminas.map((lamina) => {
      const buffer = read(lamina.archivo);
      if (createHash('sha256').update(buffer).digest('hex') !== lamina.sha256) {
        throw new Error(`${lamina.archivo}: el SHA-256 no coincide con el manifiesto.`);
      }
      const size = readJpegSize(buffer);
      if (!size) throw new Error(`${lamina.archivo}: no es un JPEG legible.`);
      if (size.width < HD_MIN_WIDTH) {
        throw new Error(`${lamina.archivo}: mide ${size.width} px de ancho; hacen falta al menos ${HD_MIN_WIDTH}.`);
      }
      return { ...lamina, buffer, ...size };
    });

    const found = await this.exercises.findAll({
      attributes: ['id', 'name', 'externalId'],
      where: { dataSource: ExerciseDataSource.EXERCISES_DATASET, externalId: files.map((file) => file.ejercicio) },
    });
    const byExternalId = new Map(found.map((exercise) => [exercise.externalId, exercise]));
    for (const file of files) {
      const exercise = byExternalId.get(file.ejercicio);
      if (exercise && exercise.name !== file.en) {
        throw new Error(`${file.ejercicio}: el catálogo lo llama «${exercise.name}» y la tabla «${file.en}». No se carga nada.`);
      }
    }

    const counters = { total: files.length, created: 0, updated: 0, unchanged: 0, sinEjercicio: 0 };
    for (const file of files) {
      const exercise = byExternalId.get(file.ejercicio);
      if (!exercise) {
        counters.sinEjercicio += 1;
        continue;
      }
      const existing = await this.media.findOne({
        where: { exerciseId: exercise.id, externalId: file.externalId, mediaType: ExerciseMediaType.IMAGE },
      });
      if (existing && existing.checksumSha256 === file.sha256 && existing.status === ExerciseMediaStatus.ACTIVE) {
        counters.unchanged += 1;
        continue;
      }
      if (existing) counters.updated += 1;
      else counters.created += 1;
      if (!apply) continue;

      const stored = await this.storage.upload(
        { originalName: file.archivo, mimeType: 'image/jpeg', sizeBytes: file.buffer.byteLength, buffer: file.buffer },
        { category: 'ejercicios', exerciseId: exercise.id },
      );
      const attributes = {
        url: stored.url,
        mimeType: 'image/jpeg',
        width: file.width,
        height: file.height,
        checksumSha256: stored.checksumSha256,
        altText: `${exercise.name} exercise demonstration`.slice(0, 500),
        attribution: manifest.autor,
        license: manifest.licencia,
        status: ExerciseMediaStatus.ACTIVE,
        metadata: {
          ...(existing?.metadata ?? {}),
          source: manifest.fuente,
          licenseUrl: manifest.licenciaUrl,
          mirroredLocally: true,
          mirroredFrom: file.origenUrl,
          emparejado: { modo: 'manual', coincidencia: file.coincidencia, nota: file.nota },
          hd: { generador: manifest.generador, origenSha256: file.origenSha256 },
        },
      };
      if (existing) {
        await existing.update(attributes);
        continue;
      }
      const hasPrimary =
        (await this.media.count({ where: { exerciseId: exercise.id, isPrimary: true, status: ExerciseMediaStatus.ACTIVE } })) > 0;
      await this.media.create({
        ...attributes,
        exerciseId: exercise.id,
        mediaType: ExerciseMediaType.IMAGE,
        provider: ExerciseMediaProvider.EXTERNAL_URL,
        externalId: file.externalId,
        thumbnailUrl: null,
        isPrimary: !hasPrimary,
        sortOrder: hasPrimary ? 50 : 0,
        createdByUserId: null,
      });
    }
    this.logger.log({ event: apply ? 'media.open_stills.applied' : 'media.open_stills.dry_run', ...counters });
    return counters;
  }
}
