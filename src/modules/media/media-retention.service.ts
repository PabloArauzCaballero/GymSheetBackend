import { Inject, Injectable, Logger } from "@nestjs/common";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { MediaReferencesRepository } from "./media-references.repository";
import {
  MEDIA_STORAGE_PROVIDER,
  MediaStorageProvider,
} from "./media-storage.port";

/** Qué pasó con el binario tras borrar la fila que lo referenciaba. */
export interface MediaReleaseResult {
  /** `true` si el fichero físico se borró; `false` si otra fila lo sigue usando. */
  readonly fileRemoved: boolean;
}

/**
 * Único punto por el que se borra un binario del almacenamiento.
 *
 * El almacenamiento local deduplica por contenido (`storageKey` = SHA-256), así
 * que el mismo fichero puede estar referenciado por varias filas de varias
 * tablas y de varios usuarios. La fila propia siempre se borra; el fichero solo
 * cuando deja de tener referencias.
 *
 * ## Orden y transacción
 *
 * Todo el trabajo de base de datos —bloqueo, borrado de la fila y recuento—
 * ocurre en UNA transacción. El recuento va DESPUÉS del borrado propio: así no
 * hay que excluir la fila que estamos eliminando y la respuesta es exactamente
 * "¿queda alguien más?".
 *
 * El `unlink` va después del commit, nunca dentro de la transacción. Si el
 * proceso muere entre el commit y el `unlink`, el peor resultado es un fichero
 * huérfano (basura recuperable); al revés —borrar el fichero y luego fallar el
 * commit— dejaría filas vivas apuntando a un binario inexistente, que es
 * pérdida de datos.
 *
 * ## Condición de carrera: dos borrados simultáneos
 *
 * Sin coordinación, dos transacciones que borran las dos últimas filas del
 * mismo binario se leen mutuamente como "todavía referenciado" (en READ
 * COMMITTED, el DELETE ajeno sin confirmar no es visible), ambas se abstienen y
 * el fichero queda huérfano para siempre. Se resuelve con
 * `pg_advisory_xact_lock(hashtext(storageKey))` al principio de la transacción:
 * las dos se serializan, la segunda ve cero referencias y borra el fichero.
 *
 * El bloqueo se libera en el commit, antes del `unlink`, de modo que dos
 * borradores pueden llegar a llamar a `remove` para la misma clave. Es inocuo:
 * el contrato del proveedor es idempotente (el adaptador local comprueba
 * existencia antes de `unlink`).
 *
 * Riesgo residual conocido y aceptado: una SUBIDA del mismo contenido que
 * ocurra entre nuestro commit y nuestro `unlink` reutiliza el fichero
 * (`reused = true`) y se queda con una fila apuntando a un binario recién
 * borrado. La ventana es de microsegundos y el daño es una URL que devuelve
 * 404 para el propio autor, no la pérdida del media de un tercero. Cerrarla
 * exigiría que la ruta de subida tomase el mismo bloqueo consultivo, lo que
 * obligaría a envolver cada subida en una transacción; no se hace aquí.
 */
@Injectable()
export class MediaRetentionService {
  private readonly logger = new Logger(MediaRetentionService.name);

  constructor(
    private readonly sequelize: Sequelize,
    private readonly references: MediaReferencesRepository,
    @Inject(MEDIA_STORAGE_PROVIDER)
    private readonly storage: MediaStorageProvider,
  ) {}

  /**
   * Borra la fila propietaria (vía `deleteOwnRow`, que recibe la transacción) y
   * el fichero solo si ninguna otra fila lo referencia.
   *
   * Idempotente: si la fila ya no existe, `deleteOwnRow` no hace nada y el
   * recuento decide igual; si el fichero ya no está, el proveedor lo ignora.
   */
  async deleteRowAndUnreferencedFile(
    storageKey: string,
    deleteOwnRow: (transaction: Transaction) => Promise<void>,
  ): Promise<MediaReleaseResult> {
    const stillReferenced = await this.sequelize.transaction(
      async (transaction) => {
        await this.references.lockStorageKey(storageKey, transaction);
        await deleteOwnRow(transaction);
        return this.references.isReferenced(storageKey, transaction);
      },
    );

    if (stillReferenced) {
      this.logger.log({
        event: "media.retention.file_kept",
        storageKey,
        reason: "still_referenced",
      });
      return { fileRemoved: false };
    }

    await this.storage.remove(storageKey);
    this.logger.log({ event: "media.retention.file_removed", storageKey });
    return { fileRemoved: true };
  }
}
