import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";

/**
 * Refcount de un binario almacenado.
 *
 * `LocalStorageAdapter` nombra los ficheros por SHA-256 del contenido: dos
 * usuarios que suben el MISMO binario comparten `storageKey` y, por tanto,
 * comparten el fichero en disco. Borrar la fila propia y el fichero sin mirar
 * quién más lo referencia rompe el media de otra cuenta.
 *
 * Por eso ninguna ruta de borrado puede llamar directamente a
 * `MediaStorageProvider.remove`: primero hay que preguntar aquí.
 *
 * La consulta cubre TODAS las tablas que guardan medios servidos por nuestro
 * almacenamiento, no solo las que hoy borran:
 *
 * | Tabla                    | Columna(s)                        | Forma      |
 * |--------------------------|-----------------------------------|------------|
 * | `profile.stories`        | `storage_key`                     | clave      |
 * | `profile.photos`         | `storage_key`                     | clave      |
 * | `chat.messages`          | `media_key`                       | clave      |
 * | `media.files`            | `storage_url`                     | URL        |
 * | `training.exercise_media`| `url`, `thumbnail_url`            | URL        |
 * | `facilities.branches`    | `cover_image_url`, `gallery_image_urls` | URL  |
 *
 * Las tablas que solo guardan la URL pública (no la clave) se comparan por
 * sufijo exacto `"/<clave>"` con `right()`, nunca con `LIKE`: la clave viaja
 * como valor y no puede aportar comodines.
 */
@Injectable()
export class MediaReferencesRepository {
  constructor(private readonly sequelize: Sequelize) {}

  /**
   * Bloqueo consultivo por clave de almacenamiento, dentro de la transacción
   * que lo pide (`pg_advisory_xact_lock` se libera solo al commit/rollback).
   *
   * Serializa "borra tu fila y cuenta las que quedan" entre procesos. Sin él,
   * dos borrados simultáneos del mismo fichero se leen mutuamente como
   * "todavía referenciado" (READ COMMITTED no ve el DELETE ajeno sin
   * confirmar), ambos se abstienen de borrar el fichero y el binario queda
   * huérfano para siempre.
   */
  async lockStorageKey(
    storageKey: string,
    transaction: Transaction,
  ): Promise<void> {
    await this.sequelize.query(
      "SELECT pg_advisory_xact_lock(hashtext(:storageKey))",
      { replacements: { storageKey }, transaction },
    );
  }

  /**
   * `true` si alguna fila sigue apuntando al binario. `EXISTS` sobre un
   * `UNION ALL` corta en la primera coincidencia: no cuenta de más.
   */
  async isReferenced(
    storageKey: string,
    transaction?: Transaction,
  ): Promise<boolean> {
    const urlSuffix = `/${storageKey}`;
    const rows = await this.sequelize.query<{ referenced: boolean }>(
      `SELECT EXISTS (
                SELECT 1 FROM profile.stories WHERE storage_key = :storageKey
                 UNION ALL
                SELECT 1 FROM profile.photos WHERE storage_key = :storageKey
                 UNION ALL
                SELECT 1 FROM chat.messages WHERE media_key = :storageKey
                 UNION ALL
                SELECT 1 FROM media.files
                 WHERE storage_url IS NOT NULL
                   AND right(storage_url, :suffixLength) = :urlSuffix
                 UNION ALL
                SELECT 1 FROM training.exercise_media
                 WHERE right(url, :suffixLength) = :urlSuffix
                    OR (thumbnail_url IS NOT NULL
                        AND right(thumbnail_url, :suffixLength) = :urlSuffix)
                 UNION ALL
                SELECT 1 FROM facilities.branches
                 WHERE (cover_image_url IS NOT NULL
                        AND right(cover_image_url, :suffixLength) = :urlSuffix)
                    OR EXISTS (
                         SELECT 1 FROM unnest(gallery_image_urls) AS gallery(image_url)
                          WHERE right(gallery.image_url, :suffixLength) = :urlSuffix
                       )
              ) AS referenced`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          storageKey,
          urlSuffix,
          suffixLength: urlSuffix.length,
        },
        transaction,
      },
    );

    return rows[0]?.referenced === true;
  }
}
