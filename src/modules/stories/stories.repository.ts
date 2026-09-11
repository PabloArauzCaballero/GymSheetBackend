import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ConnectionStatus } from "../../common/enums/domain.enums";
import type { StoredAsset } from "../media/media-storage.port";
import { StoryModel, StoryMediaType } from "./story.model";
import { StoryViewModel } from "./story-view.model";

export interface StoryFeedRow {
  id: string;
  user_id: string;
  full_name: string;
  photo_url: string | null;
  media_url: string;
  media_type: StoryMediaType;
  /**
   * `Date`, no `string`: el driver de PostgreSQL materializa `timestamptz` como
   * `Date`. Declararlo `string` compilaba y se serializaba bien a JSON, pero
   * cualquier `.slice()`/`.startsWith()` sobre el campo reventaba en ejecución
   * sin que el compilador avisara. Mismo criterio que `StoryViewerRow.viewed_at`:
   * el tipo dice la verdad y el mapper normaliza a ISO.
   */
  created_at: Date;
  expires_at: Date;
  viewed_by_me: boolean;
}

/** Una fila por espectador de una story propia. */
export interface StoryViewerRow {
  user_id: string;
  full_name: string;
  photo_url: string | null;
  viewed_at: Date;
}

/**
 * Referencia mínima de una story caducada: lo justo para borrarla y decidir
 * sobre su binario. Deliberadamente NO es un modelo de Sequelize — la purga no
 * necesita la fila entera y los modelos ORM no salen del repositorio.
 */
export interface ExpiredStoryReference {
  readonly id: string;
  readonly storageKey: string;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Topes del feed. Sin ellos la consulta devolvía **todas** las stories vigentes
 * de **todos** los matches de una sola vez (medido: 1200 filas con 300 matches),
 * y el coste crecía con el tamaño del gimnasio, no con lo que el usuario llega a
 * mirar.
 *
 * - `STORY_FEED_MAX_AUTHORS = 30`: el carrusel se consume por la cabecera; 30
 *   personas es más de lo que nadie recorre en una sesión, y el `ORDER BY` deja
 *   arriba justo a quien importa (uno mismo → quien tiene contenido sin ver →
 *   quien publicó más reciente), así que el recorte cae en la cola irrelevante.
 * - `STORY_FEED_MAX_STORIES_PER_AUTHOR = 20`: una story vive 24 h; 20 por
 *   persona cubre con holgura lo que se publica en ese plazo, y se conservan las
 *   **más recientes** (el mapper las muestra igualmente en orden cronológico).
 *
 * Techo resultante: 600 filas. Cuando el producto necesite pasar de ahí, lo que
 * toca es paginación por cursor sobre `ranked_authors`, no subir el tope.
 */
export const STORY_FEED_MAX_AUTHORS = 30;
export const STORY_FEED_MAX_STORIES_PER_AUTHOR = 20;

@Injectable()
export class StoriesRepository {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(StoryModel) private readonly stories: typeof StoryModel,
    @InjectModel(StoryViewModel) private readonly views: typeof StoryViewModel,
  ) {}

  async create(
    userId: string,
    tenantId: string,
    asset: StoredAsset,
    mediaType: StoryMediaType,
  ): Promise<StoryModel> {
    return this.stories.create({
      userId,
      tenantId,
      mediaUrl: asset.url,
      storageProvider: asset.provider,
      storageKey: asset.key,
      mediaType,
      expiresAt: new Date(Date.now() + ONE_DAY_MS),
    });
  }

  findByIdForUser(id: string, userId: string): Promise<StoryModel | null> {
    return this.stories.findOne({ where: { id, userId } });
  }

  findById(id: string): Promise<StoryModel | null> {
    return this.stories.findByPk(id);
  }

  async delete(story: StoryModel, transaction?: Transaction): Promise<void> {
    await story.destroy({ transaction });
  }

  /**
   * Stories ya caducadas, de la más antigua a la más nueva, acotadas por lote.
   * El índice `ix_profile_stories_feed (tenant_id, expires_at)` no sirve aquí
   * (no filtramos por tenant), pero la tabla se mantiene pequeña justamente
   * porque esta purga corre.
   */
  async findExpired(
    now: Date,
    limit: number,
  ): Promise<ExpiredStoryReference[]> {
    return this.sequelize.query<ExpiredStoryReference>(
      `SELECT id, storage_key AS "storageKey"
         FROM profile.stories
        WHERE expires_at <= :now
        ORDER BY expires_at ASC
        LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { now, limit } },
    );
  }

  /**
   * Borrado por id, idempotente: devuelve cuántas filas cayeron, de modo que
   * dos purgas simultáneas sobre la misma story no se estorban.
   */
  async deleteById(id: string, transaction?: Transaction): Promise<number> {
    return this.stories.destroy({ where: { id }, transaction });
  }

  /**
   * ¿Hay conexión `ACCEPTED` entre dos personas? La dirección no importa: la
   * fila puede estar guardada en cualquiera de los dos sentidos.
   *
   * Es la regla de visibilidad del feed expresada como pregunta suelta, para que
   * `view` pueda aplicar exactamente la misma que `feedForConnections` sin
   * duplicar el SQL del feed.
   */
  async hasAcceptedConnection(userId: string, otherUserId: string): Promise<boolean> {
    const rows = await this.sequelize.query<{ ok: number }>(
      `SELECT 1 AS ok
         FROM social.connections c
        WHERE c.status = :acceptedStatus
          AND (
            (c.requester_id = :userId AND c.addressee_id = :otherUserId)
            OR (c.addressee_id = :userId AND c.requester_id = :otherUserId)
          )
        LIMIT 1`,
      {
        type: QueryTypes.SELECT,
        replacements: { userId, otherUserId, acceptedStatus: ConnectionStatus.ACCEPTED },
      },
    );
    return rows.length > 0;
  }

  /**
   * Stories activas de las personas con las que el viewer hace match, más las
   * suyas propias. El tenant ya no basta como perímetro: una story es contenido
   * personal y solo la ven los `ACCEPTED` (R2.1), así que la pertenencia a
   * `visible_authors` es la autorización, y `tenant_id`/`expires_at` quedan como
   * defensa en profundidad.
   *
   * **Por qué CTE y no `EXISTS` por fila** (medido con 500 socios, 300 matches y
   * 2000 stories vigentes): con `EXISTS` el planificador recorría la tabla de
   * stories entera y evaluaba el subplan una vez por story (`loops=2005`, 12 390
   * buffers, 1200 filas devueltas). Materializando primero los ~300 ids con
   * conexión aceptada, el acceso pasa a ser una búsqueda por autor sobre
   * `ix_profile_stories_user (user_id, created_at)`: 3 649 buffers y 120 filas.
   *
   * Los topes (`STORY_FEED_MAX_AUTHORS`, `STORY_FEED_MAX_STORIES_PER_AUTHOR`)
   * acotan la respuesta: el recorte se aplica **después** de ordenar, así que lo
   * que se pierde es la cola, nunca lo que el usuario ve primero.
   *
   * Orden de Instagram (R2.2), resuelto en SQL para que el mapper no reordene:
   *   1. las propias del viewer;
   *   2. quien tenga al menos una story sin ver (`bool_or(NOT viewed_by_me)`);
   *   3. dentro de cada grupo, la persona con la story más reciente primero;
   *   4. `s.user_id` desempata: sin él, dos personas con el mismo
   *      `max(created_at)` podrían intercalar sus filas y romper la agrupación
   *      del mapper;
   *   5. las stories de una persona, en el orden en que se publicaron.
   */
  async feedForConnections(viewerId: string, tenantId: string): Promise<StoryFeedRow[]> {
    return this.sequelize.query<StoryFeedRow>(
      `WITH visible_authors AS MATERIALIZED (
         SELECT CAST(:viewerId AS uuid) AS user_id
         UNION
         SELECT c.addressee_id
           FROM social.connections c
          WHERE c.requester_id = :viewerId AND c.status = :acceptedStatus
         UNION
         SELECT c.requester_id
           FROM social.connections c
          WHERE c.addressee_id = :viewerId AND c.status = :acceptedStatus
       ),
       active_stories AS MATERIALIZED (
         SELECT s.id, s.user_id, s.media_url, s.media_type, s.created_at, s.expires_at
           FROM visible_authors a
           CROSS JOIN LATERAL (
             SELECT st.id, st.user_id, st.media_url, st.media_type, st.created_at, st.expires_at
               FROM profile.stories st
              WHERE st.user_id = a.user_id
                AND st.tenant_id = :tenantId
                AND st.expires_at > now()
              ORDER BY st.created_at DESC, st.id DESC
              LIMIT :storiesPerAuthor
           ) s
       ),
       seen AS MATERIALIZED (
         SELECT s.id, s.user_id, s.media_url, s.media_type, s.created_at, s.expires_at,
                (v.viewer_id IS NOT NULL) AS viewed_by_me
           FROM active_stories s
           LEFT JOIN profile.story_views v
             ON v.story_id = s.id AND v.viewer_id = :viewerId
       ),
       ranked_authors AS (
         SELECT user_id,
                bool_or(NOT viewed_by_me) AS has_unviewed,
                max(created_at) AS latest_created_at
           FROM seen
          GROUP BY user_id
          ORDER BY (user_id = CAST(:viewerId AS uuid)) DESC,
                   has_unviewed DESC,
                   latest_created_at DESC,
                   user_id
          LIMIT :maxAuthors
       )
       SELECT s.id,
              s.user_id,
              u.nombre_completo AS full_name,
              photo.url AS photo_url,
              s.media_url,
              s.media_type,
              s.created_at,
              s.expires_at,
              s.viewed_by_me
         FROM ranked_authors a
         JOIN seen s ON s.user_id = a.user_id
         JOIN public.usuarios u ON u.id = a.user_id
         LEFT JOIN LATERAL (
           SELECT url FROM profile.photos p
            WHERE p.user_id = a.user_id
            ORDER BY p.position ASC LIMIT 1
         ) photo ON true
        ORDER BY (s.user_id = CAST(:viewerId AS uuid)) DESC,
                 a.has_unviewed DESC,
                 a.latest_created_at DESC,
                 s.user_id,
                 s.created_at ASC,
                 s.id`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          viewerId,
          tenantId,
          acceptedStatus: ConnectionStatus.ACCEPTED,
          maxAuthors: STORY_FEED_MAX_AUTHORS,
          storiesPerAuthor: STORY_FEED_MAX_STORIES_PER_AUTHOR,
        },
      },
    );
  }

  /**
   * Quién vio una story, del más reciente al más antiguo. El `tenant_id` viaja
   * en la consulta y no solo en la comprobación de propiedad del servicio: si
   * alguien llegara con el id de una story de otro gimnasio, la lista sale vacía
   * en vez de filtrar nombres.
   *
   * Además solo aparecen el propio autor y sus `ACCEPTED`: es la misma regla que
   * el feed, aplicada aquí como defensa en profundidad. `view` ya rechaza a
   * quien no es match, pero las vistas grabadas **antes** de ese arreglo siguen
   * en la tabla, y publicar nombre y foto de alguien que no es match es
   * exactamente la fuga que se está cerrando.
   */
  async viewersOf(storyId: string, tenantId: string): Promise<StoryViewerRow[]> {
    return this.sequelize.query<StoryViewerRow>(
      `SELECT v.viewer_id AS user_id,
              u.nombre_completo AS full_name,
              photo.url AS photo_url,
              v.viewed_at
         FROM profile.story_views v
         JOIN profile.stories s ON s.id = v.story_id
         JOIN public.usuarios u ON u.id = v.viewer_id
         LEFT JOIN LATERAL (
           SELECT url FROM profile.photos p
            WHERE p.user_id = v.viewer_id
            ORDER BY p.position ASC LIMIT 1
         ) photo ON true
        WHERE v.story_id = :storyId
          AND s.tenant_id = :tenantId
          AND (
            v.viewer_id = s.user_id
            OR EXISTS (
              SELECT 1
                FROM social.connections c
               WHERE c.status = :acceptedStatus
                 AND (
                   (c.requester_id = s.user_id AND c.addressee_id = v.viewer_id)
                   OR (c.addressee_id = s.user_id AND c.requester_id = v.viewer_id)
                 )
            )
          )
        ORDER BY v.viewed_at DESC, v.viewer_id`,
      {
        type: QueryTypes.SELECT,
        replacements: { storyId, tenantId, acceptedStatus: ConnectionStatus.ACCEPTED },
      },
    );
  }

  /** Idempotente: ver la misma story dos veces no falla ni duplica. */
  async recordView(storyId: string, viewerId: string): Promise<void> {
    await this.views.findOrCreate({
      where: { storyId, viewerId },
      defaults: { storyId, viewerId, viewedAt: new Date() },
    });
  }
}
