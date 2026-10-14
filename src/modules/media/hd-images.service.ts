import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { createHash } from 'crypto';
import { ExerciseMediaStatus, ExerciseMediaType } from '../../common/enums/domain.enums';
import { ExerciseMediaModel } from '../exercises/exercise-media.model';
import { HD_MIN_WIDTH, HdManifest, readJpegSize } from './hd-images';
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from './media-storage.port';

export interface HdImagesResult {
  /** Filas de lámina a las que les corresponde un archivo de la entrega. */
  readonly candidates: number;
  readonly upgraded: number;
  /** Ya tenían exactamente ese archivo: segunda pasada. */
  readonly unchanged: number;
  /** Entradas del manifiesto sin ninguna fila activa que las use. */
  readonly sinFila: number;
}

export type HdImageReader = (archivo: string) => Buffer;

/**
 * Sustituye las láminas de 850 px por su versión reescalada.
 *
 * Todo o nada en la validación: antes de escribir se comprueba que cada archivo
 * existe, que su SHA-256 es el del manifiesto, que es un JPEG y que llega al
 * ancho nítido. El almacén no borra, así que una entrega a medias dejaría
 * objetos huérfanos.
 *
 * Idempotente: una fila cuyo `checksum_sha256` ya es el del archivo no se toca.
 * La URL anterior queda en `metadata.hd.reemplaza`, y `metadata.mirroredFrom`
 * se conserva: es lo que impide que la importación diaria devuelva la fila a la
 * imagen de origen.
 */
@Injectable()
export class HdImagesService {
  private readonly logger = new Logger(HdImagesService.name);

  constructor(
    @InjectModel(ExerciseMediaModel) private readonly media: typeof ExerciseMediaModel,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
  ) {}

  /** Láminas activas por debajo del ancho nítido (o sin medir): lo que queda por reescalar. */
  async pending(): Promise<Array<{ externalId: string; url: string; width: number | null }>> {
    const rows = await this.media.findAll({
      attributes: ['externalId', 'url', 'width'],
      where: { mediaType: ExerciseMediaType.IMAGE, status: ExerciseMediaStatus.ACTIVE },
    });
    const byExternalId = new Map<string, { externalId: string; url: string; width: number | null }>();
    for (const row of rows) {
      if (!row.externalId || (row.width ?? 0) >= HD_MIN_WIDTH) continue;
      byExternalId.set(row.externalId, { externalId: row.externalId, url: row.url, width: row.width });
    }
    return [...byExternalId.values()].sort((a, b) => a.externalId.localeCompare(b.externalId));
  }

  async apply(manifest: HdManifest, read: HdImageReader, { apply }: { apply: boolean }): Promise<HdImagesResult> {
    const files = manifest.laminas.map((lamina) => {
      const buffer = read(lamina.archivo);
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      if (sha256 !== lamina.sha256) {
        throw new Error(`${lamina.archivo}: el SHA-256 no coincide con el manifiesto.`);
      }
      const size = readJpegSize(buffer);
      if (!size) throw new Error(`${lamina.archivo}: no es un JPEG legible.`);
      if (size.width < HD_MIN_WIDTH) {
        throw new Error(`${lamina.archivo}: mide ${size.width} px de ancho; hacen falta al menos ${HD_MIN_WIDTH}.`);
      }
      return { ...lamina, buffer, ...size };
    });

    let candidates = 0;
    let upgraded = 0;
    let unchanged = 0;
    let sinFila = 0;
    for (const file of files) {
      const rows = await this.media.findAll({
        where: { externalId: file.externalId, mediaType: ExerciseMediaType.IMAGE, status: ExerciseMediaStatus.ACTIVE },
      });
      if (rows.length === 0) sinFila += 1;
      for (const row of rows) {
        candidates += 1;
        if (row.checksumSha256 === file.sha256) {
          unchanged += 1;
          continue;
        }
        if (!apply) continue;
        const stored = await this.storage.upload(
          { originalName: file.archivo, mimeType: 'image/jpeg', sizeBytes: file.buffer.byteLength, buffer: file.buffer },
          { category: 'ejercicios', exerciseId: row.exerciseId },
        );
        const mirroredFrom =
          typeof row.metadata?.mirroredFrom === 'string' ? row.metadata.mirroredFrom : row.url;
        await row.update({
          url: stored.url,
          mimeType: 'image/jpeg',
          width: file.width,
          height: file.height,
          checksumSha256: stored.checksumSha256,
          metadata: {
            ...row.metadata,
            mirroredLocally: true,
            mirroredFrom,
            hd: { generador: manifest.generador, origenSha256: file.origenSha256, reemplaza: row.url },
          },
        });
        upgraded += 1;
      }
    }
    this.logger.log({ event: apply ? 'media.hd_images.applied' : 'media.hd_images.dry_run', candidates, upgraded, unchanged, sinFila });
    return { candidates, upgraded, unchanged, sinFila };
  }
}
