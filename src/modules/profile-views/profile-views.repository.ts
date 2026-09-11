import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ProfileSocialSettingsModel } from "../social/profile-social-settings.model";
import { ProfileViewModel } from "./profile-view.model";
import { ProfileViewersCursor } from "./profile-views.cursor";

/** Un espectador, ya agregado: una fila por persona, no por visita. */
export interface ProfileViewerRow {
  userId: string;
  fullName: string;
  photoUrl: string | null;
  objetivo: string | null;
  branchName: string | null;
  lastViewedAt: Date;
  viewCount: number;
}

/** Los tres contadores de la cabecera de "quién vio mi perfil". */
export interface ProfileViewsSummaryRow {
  uniqueViewersToday: number;
  totalUnique: number;
  newSinceLastCheck: number;
}

export interface ProfileViewersPage {
  limit: number;
  cursor: ProfileViewersCursor | null;
}

/**
 * Los espectadores admisibles, agregados por persona.
 *
 * Se comparte entre la lista y el resumen para que los contadores nunca digan
 * un número que la lista no puede enseñar: mismo filtro de tenant, mismo
 * `estado = 'ACTIVO'`, misma agregación por espectador.
 *
 * El filtro de gimnasio se hace contra `usuarios.tenant_id` y no contra
 * `profile_views.tenant_id`: la columna de la visita guarda el gimnasio que
 * había cuando ocurrió, y si alguien cambió de sede desde entonces la verdad
 * de hoy es la de su cuenta.
 */
const VIEWERS_CTE = `
  SELECT pv.viewer_id,
         MAX(pv.viewed_at) AS last_viewed_at,
         COUNT(*) AS view_count
    FROM profile.profile_views pv
    JOIN public.usuarios u ON u.id = pv.viewer_id
   WHERE pv.viewed_user_id = :userId
     AND u.estado = 'ACTIVO'
     AND COALESCE(u.tenant_id, :defaultTenantId) = :tenantId
   GROUP BY pv.viewer_id`;

@Injectable()
export class ProfileViewsRepository {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(ProfileViewModel) private readonly views: typeof ProfileViewModel,
    @InjectModel(ProfileSocialSettingsModel)
    private readonly settings: typeof ProfileSocialSettingsModel,
  ) {}

  record(viewerId: string, viewedUserId: string, tenantId: string): Promise<ProfileViewModel> {
    return this.views.create({ viewerId, viewedUserId, tenantId });
  }

  /**
   * Una página de espectadores, en una sola consulta. Devuelve tantas filas
   * como pida `page.limit`, sin interpretarlo: es el servicio quien pide una de
   * más para saber si hay página siguiente.
   *
   * La paginación es keyset sobre `(last_viewed_at, viewer_id)`. La comparación
   * es de tupla —`(a, b) < (c, d)`— y no dos condiciones sueltas con OR porque
   * es exactamente el mismo criterio que el `ORDER BY`, y por tanto imposible
   * de desalinear al tocarlo.
   */
  async listViewers(
    userId: string,
    tenantId: string,
    defaultTenantId: string,
    page: ProfileViewersPage,
  ): Promise<ProfileViewerRow[]> {
    const rows = await this.sequelize.query<{
      viewer_id: string;
      full_name: string;
      photo_url: string | null;
      objetivo: string | null;
      branch_name: string | null;
      last_viewed_at: Date;
      view_count: string;
    }>(
      `WITH viewers AS (${VIEWERS_CTE})
       SELECT v.viewer_id,
              u.nombre_completo AS full_name,
              p.objetivo,
              b.name AS branch_name,
              ph.url AS photo_url,
              v.last_viewed_at,
              v.view_count
         FROM viewers v
         JOIN public.usuarios u ON u.id = v.viewer_id
         LEFT JOIN public.perfiles_antropometricos p ON p.usuario_id = u.id
         -- Misma condición que \`SocialRepository.directory()\`: la sucursal sólo
         -- se resuelve si es del mismo gimnasio. \`usuarios.sede_id\` es un UUID
         -- suelto y puede apuntar a una sede que hoy es de otra marca; sin esta
         -- condición la lista enseñaría el nombre de la sucursal de un
         -- competidor, y con ella esa referencia cruzada se degrada a nula.
         LEFT JOIN facilities.branches b
           ON b.id = u.sede_id
          AND COALESCE(b.tenant_id, :defaultTenantId) = :tenantId
         -- Sólo la portada: esta lista no pasa fotos con el dedo, así que traer
         -- la galería entera sería trabajo tirado.
         LEFT JOIN LATERAL (
           SELECT g.url
             FROM profile.photos g
            WHERE g.user_id = u.id
            ORDER BY g.position ASC, g.created_at ASC
            LIMIT 1
         ) ph ON true
        WHERE (:cursorViewedAt::timestamptz IS NULL
            OR (v.last_viewed_at, v.viewer_id)
             < (:cursorViewedAt::timestamptz, :cursorUserId::uuid))
        ORDER BY v.last_viewed_at DESC, v.viewer_id DESC
        LIMIT :limit`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          userId,
          tenantId,
          defaultTenantId,
          cursorViewedAt: page.cursor?.lastViewedAt ?? null,
          cursorUserId: page.cursor?.userId ?? null,
          limit: page.limit,
        },
      },
    );

    return rows.map((row) => ({
      userId: row.viewer_id,
      fullName: row.full_name,
      photoUrl: row.photo_url,
      objetivo: row.objetivo,
      branchName: row.branch_name,
      lastViewedAt: new Date(row.last_viewed_at),
      // `COUNT(*)` es bigint y el driver lo entrega como texto.
      viewCount: Number(row.view_count),
    }));
  }

  /**
   * Los tres contadores, en una sola consulta.
   *
   * `-infinity` sustituye al "nunca revisó": así el filtro de novedad es una
   * comparación normal y no hay que duplicar la condición para el caso nulo.
   */
  async summaryFor(
    userId: string,
    tenantId: string,
    defaultTenantId: string,
  ): Promise<ProfileViewsSummaryRow> {
    const rows = await this.sequelize.query<{
      unique_today: string;
      total_unique: string;
      new_since_last_check: string;
    }>(
      `WITH checked AS (
         SELECT COALESCE(MAX(s.profile_views_checked_at), '-infinity'::timestamptz) AS at
           FROM social.profile_settings s
          WHERE s.user_id = :userId
       ),
       viewers AS (${VIEWERS_CTE})
       SELECT COUNT(*) FILTER (WHERE v.last_viewed_at >= date_trunc('day', now()))
                AS unique_today,
              COUNT(*) AS total_unique,
              COUNT(*) FILTER (WHERE v.last_viewed_at > c.at) AS new_since_last_check
         FROM viewers v
         CROSS JOIN checked c`,
      { type: QueryTypes.SELECT, replacements: { userId, tenantId, defaultTenantId } },
    );

    const row = rows[0];
    return {
      uniqueViewersToday: Number(row?.unique_today ?? 0),
      totalUnique: Number(row?.total_unique ?? 0),
      newSinceLastCheck: Number(row?.new_since_last_check ?? 0),
    };
  }

  /** Cuándo abrió por última vez la lista. Nulo = nunca. */
  async findCheckedAt(userId: string): Promise<Date | null> {
    const row = await this.settings.findByPk(userId, { attributes: ["profileViewsCheckedAt"] });
    return row?.profileViewsCheckedAt ?? null;
  }

  /**
   * Marca la lista como revisada, creando la fila de ajustes si no existía.
   *
   * SQL crudo y no `Model.upsert`, para acotar el `DO UPDATE` a las dos
   * columnas que esta operación tiene derecho a mover.
   *
   * `Model.upsert` de Sequelize 6 también se limita hoy a los campos que se le
   * pasan —se comprobó ejecutándolo contra la base: con `visible = true` y un
   * estado social puesto, ninguno de los dos se pisa—, así que esto no corrige
   * ningún fallo del ORM. Lo que compra es que el conjunto de columnas
   * actualizadas quede escrito aquí y no dependa de qué decida incluir el ORM:
   * esta fila guarda la visibilidad social de una persona, y apagarla sin que
   * lo pida sería un fallo de privacidad, no un detalle de implementación.
   */
  async markChecked(userId: string): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO social.profile_settings (user_id, visible, profile_views_checked_at, updated_at)
            VALUES (:userId, false, now(), now())
       ON CONFLICT (user_id) DO UPDATE
               SET profile_views_checked_at = now(),
                   updated_at = now()`,
      { type: QueryTypes.INSERT, replacements: { userId } },
    );
  }
}
