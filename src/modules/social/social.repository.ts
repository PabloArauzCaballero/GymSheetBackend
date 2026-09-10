import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { Op, QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ConnectionStatus } from "../../common/enums/domain.enums";
import { ConnectionModel } from "./connection.model";
import { DiscoveryPassModel } from "./discovery-pass.model";
import { ProfileSocialSettingsModel } from "./profile-social-settings.model";

/** Escapa los comodines de LIKE/ILIKE para que la búsqueda trate `%` y `_` como texto literal. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export interface DirectoryRow {
  userId: string;
  fullName: string;
  objetivo: string | null;
  branchId: string | null;
  branchName: string | null;
  connectionStatus: "NONE" | "PENDING_SENT" | "PENDING_RECEIVED" | "ACCEPTED";
  connectionId: string | null;
  /** Solo si `connectionStatus` es `ACCEPTED` y la otra persona lo marcó visible. */
  socialStatus: string | null;
  /** Su primera foto de perfil (menor `position`), o `null` si no subió ninguna. */
  photoUrl: string | null;
  gender: string | null;
  experienceLevel: string | null;
  points: number | null;
  levelCode: string | null;
}

/**
 * Qué recorte del directorio se pide.
 *
 * Los tres consumidores —directorio, baraja de descubrimiento y perfil de un
 * socio— son la misma consulta con distinto recorte, así que se parametriza en
 * vez de copiarla: cualquier campo nuevo del perfil aparece en los tres a la vez.
 */
export interface DirectoryFilters {
  objetivo?: string;
  branchId?: string;
  gender?: string;
  search?: string;
  limit: number;
  /** Restringe la consulta a una sola persona (perfil individual). */
  targetUserId?: string;
  /**
   * Baraja: fuera quien ya tiene conexión en cualquier estado (incluido
   * `REJECTED`) y quien el viewer ya descartó.
   */
  excludeDecided?: boolean;
  /** Alfabético para el directorio; por puntos para la baraja. */
  orderBy?: "name" | "points";
}

/** Qué fue lo último que decidió el viewer, y qué hay que tocar para revertirlo. */
export interface LastSwipeRow {
  kind: "PASS" | "LIKE_SENT" | "LIKE_ACCEPTED";
  targetId: string;
  connectionId: string | null;
  connectionStatus: ConnectionStatus | null;
  decidedAt: Date;
}

/** Insignia ya conseguida, con los datos del catálogo que la describen. */
export interface EarnedBadgeRow {
  code: string;
  name: string;
  description: string;
  flavorText: string | null;
  category: string;
  rarity: string;
  icon: string;
  color: string;
  pointsReward: number;
  awardedAt: Date;
}

@Injectable()
export class SocialRepository {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(ConnectionModel)
    private readonly connections: typeof ConnectionModel,
    @InjectModel(ProfileSocialSettingsModel)
    private readonly settings: typeof ProfileSocialSettingsModel,
    @InjectModel(DiscoveryPassModel)
    private readonly passes: typeof DiscoveryPassModel,
  ) {}

  /** Ejecuta `work` dentro de una transacción propia. */
  runInTransaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.sequelize.transaction(work);
  }

  /** Cualquier conexión no rechazada entre dos usuarios, en cualquier dirección. */
  findActiveBetween(
    userA: string,
    userB: string,
    transaction?: Transaction,
  ): Promise<ConnectionModel | null> {
    return this.connections.findOne({
      where: {
        status: { [Op.ne]: ConnectionStatus.REJECTED },
        [Op.or]: [
          { requesterId: userA, addresseeId: userB },
          { requesterId: userB, addresseeId: userA },
        ],
      },
      transaction,
    });
  }

  create(
    requesterId: string,
    addresseeId: string,
    transaction?: Transaction,
  ): Promise<ConnectionModel> {
    return this.connections.create(
      { requesterId, addresseeId, status: ConnectionStatus.PENDING },
      { transaction },
    );
  }

  findByIdForUser(
    id: string,
    userId: string,
    transaction?: Transaction,
  ): Promise<ConnectionModel | null> {
    return this.connections.findOne({
      where: { id, [Op.or]: [{ requesterId: userId }, { addresseeId: userId }] },
      transaction,
    });
  }

  async listForUser(userId: string, status?: ConnectionStatus): Promise<ConnectionModel[]> {
    return this.connections.findAll({
      where: {
        [Op.or]: [{ requesterId: userId }, { addresseeId: userId }],
        ...(status ? { status } : {}),
      },
      order: [["createdAt", "DESC"]],
    });
  }

  /** Nombres de la otra parte de cada conexión, en un solo viaje a la base. */
  async namesFor(userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.sequelize.query<{ id: string; nombre_completo: string }>(
      `SELECT id, nombre_completo FROM public.usuarios WHERE id IN (:ids)`,
      { type: QueryTypes.SELECT, replacements: { ids: userIds } },
    );
    return new Map(rows.map((row) => [row.id, row.nombre_completo]));
  }

  async respond(
    connection: ConnectionModel,
    status: ConnectionStatus,
    transaction?: Transaction,
  ): Promise<ConnectionModel> {
    await connection.update({ status, respondedAt: new Date() }, { transaction });
    return connection;
  }

  /** Devuelve una conexión aceptada al estado en que estaba antes del match. */
  async revertToPending(
    connection: ConnectionModel,
    transaction?: Transaction,
  ): Promise<ConnectionModel> {
    await connection.update(
      { status: ConnectionStatus.PENDING, respondedAt: null },
      { transaction },
    );
    return connection;
  }

  getSettings(userId: string): Promise<ProfileSocialSettingsModel | null> {
    return this.settings.findByPk(userId);
  }

  async upsertSettings(
    userId: string,
    input: { socialStatus: string | null; visible: boolean },
  ): Promise<ProfileSocialSettingsModel> {
    const [row] = await this.settings.upsert({ userId, ...input });
    return row;
  }

  // ──────────────────────────────────────────────────── baraja de descubrimiento

  /**
   * Registra un descarte. Idempotente: repetir el mismo pass no es un error ni
   * mueve la fecha, así que un doble toque en el cliente no rompe nada.
   */
  async createPass(viewerId: string, targetId: string, transaction?: Transaction): Promise<void> {
    await this.passes.bulkCreate([{ viewerId, targetId }] as never, {
      ignoreDuplicates: true,
      transaction,
    });
  }

  async deletePass(viewerId: string, targetId: string, transaction?: Transaction): Promise<number> {
    return this.passes.destroy({ where: { viewerId, targetId }, transaction });
  }

  /**
   * El último swipe del viewer, sea del signo que sea.
   *
   * No hay tabla de historial: el swipe ya deja rastro fechado en las dos
   * tablas que toca, y compararlas es más simple —y no puede desincronizarse—
   * que mantener un tercer registro en paralelo.
   *
   * - `LIKE_SENT`: la solicitud la creó el viewer; la fecha del swipe es
   *   `created_at`. Deshacerla es retirarla.
   * - `LIKE_ACCEPTED`: el viewer aceptó la solicitud que ya tenía la otra
   *   persona (el «¡match!» instantáneo); la fecha del swipe es `responded_at`,
   *   no `created_at`, que es de la otra parte. Deshacerlo devuelve la
   *   solicitud a pendiente, no la borra: no era del viewer.
   * - `PASS`: la fila de `discovery_passes`.
   *
   * Las conexiones rechazadas quedan fuera: rechazar no es una acción de la
   * baraja, que solo tiene «me gusta» y «paso».
   */
  async findLastSwipe(viewerId: string, transaction?: Transaction): Promise<LastSwipeRow | null> {
    const rows = await this.sequelize.query<{
      kind: LastSwipeRow["kind"];
      target_id: string;
      connection_id: string | null;
      connection_status: string | null;
      decided_at: Date;
    }>(
      `SELECT 'LIKE_SENT' AS kind,
              c.addressee_id AS target_id,
              c.id AS connection_id,
              c.status AS connection_status,
              c.created_at AS decided_at
         FROM social.connections c
        WHERE c.requester_id = :viewerId AND c.status <> 'REJECTED'
        UNION ALL
       SELECT 'LIKE_ACCEPTED',
              c.requester_id,
              c.id,
              c.status,
              c.responded_at
         FROM social.connections c
        WHERE c.addressee_id = :viewerId
          AND c.status = 'ACCEPTED'
          AND c.responded_at IS NOT NULL
        UNION ALL
       SELECT 'PASS',
              dp.target_id,
              NULL::uuid,
              NULL::varchar,
              dp.created_at
         FROM social.discovery_passes dp
        WHERE dp.viewer_id = :viewerId
        ORDER BY decided_at DESC
        LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { viewerId }, transaction },
    );

    const row = rows[0];
    if (!row) return null;
    return {
      kind: row.kind,
      targetId: row.target_id,
      connectionId: row.connection_id,
      connectionStatus: (row.connection_status as ConnectionStatus | null) ?? null,
      decidedAt: new Date(row.decided_at),
    };
  }

  /**
   * ¿La conversación directa entre estos dos ya tiene algún mensaje?
   *
   * Se consulta con SQL en vez de inyectar `ChatRepository` porque el módulo de
   * chat ya importa al social: pedirle el favor de vuelta cerraría el ciclo de
   * dependencias. Mismo criterio de «conversación directa» que
   * `ChatRepository.findDirectConversation`: ambos participan y no hay un tercero.
   */
  async directConversationHasMessages(
    userA: string,
    userB: string,
    transaction?: Transaction,
  ): Promise<boolean> {
    const rows = await this.sequelize.query<{ found: number }>(
      `SELECT 1 AS found
         FROM chat.participants p1
         JOIN chat.participants p2 ON p2.conversation_id = p1.conversation_id
        WHERE p1.user_id = :userA AND p2.user_id = :userB
          AND (SELECT COUNT(*) FROM chat.participants p3
                WHERE p3.conversation_id = p1.conversation_id) = 2
          AND EXISTS (SELECT 1 FROM chat.messages m
                       WHERE m.conversation_id = p1.conversation_id)
        LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { userA, userB }, transaction },
    );
    return rows.length > 0;
  }

  /**
   * Insignias ya conseguidas por alguien, para mostrarlas en su perfil.
   *
   * Solo lectura: `progression.user_badges` es la fuente de verdad de lo ganado
   * y se une al catálogo por `badge_id`, que es la insignia que se resolvió en
   * su momento. Mirar el perfil de otro socio no puede otorgar nada, así que
   * este camino no pasa por `ProgressionService.getProgression`, que recalcula
   * y concede.
   */
  async listEarnedBadges(userId: string): Promise<EarnedBadgeRow[]> {
    const rows = await this.sequelize.query<{
      code: string;
      name: string;
      description: string;
      flavor_text: string | null;
      category: string;
      rarity: string;
      icon: string;
      color: string;
      points_reward: number;
      awarded_at: Date;
    }>(
      `SELECT b.code,
              b.name,
              b.description,
              b.flavor_text,
              b.category,
              b.rarity,
              b.icon,
              b.color,
              b.points_reward,
              ub.awarded_at
         FROM progression.user_badges ub
         JOIN progression.badges b ON b.id = ub.badge_id
        WHERE ub.usuario_id = :userId
          AND b.active
        ORDER BY ub.awarded_at DESC`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );

    return rows.map((row) => ({
      code: row.code,
      name: row.name,
      description: row.description,
      flavorText: row.flavor_text,
      category: row.category,
      rarity: row.rarity,
      icon: row.icon,
      color: row.color,
      pointsReward: Number(row.points_reward),
      awardedAt: new Date(row.awarded_at),
    }));
  }

  /**
   * El directorio del gimnasio: otros socios, con el estado de conexión visto
   * desde quien pregunta. `usuario_id <> :viewerId` se hace en SQL para no
   * traer a la propia cuenta y descartarla después.
   */
  async directory(
    viewerId: string,
    tenantId: string,
    defaultTenantId: string,
    filters: DirectoryFilters,
  ): Promise<DirectoryRow[]> {
    // Lista blanca, nunca entrada del usuario: la cláusula se interpola.
    const orderBy =
      filters.orderBy === "points"
        ? "up.points DESC NULLS LAST, u.nombre_completo ASC"
        : "u.nombre_completo ASC";

    const rows = await this.sequelize.query<{
      usuario_id: string;
      full_name: string;
      objetivo: string | null;
      branch_id: string | null;
      branch_name: string | null;
      connection_id: string | null;
      connection_status: string | null;
      requester_id: string | null;
      social_status: string | null;
      social_visible: boolean | null;
      photo_url: string | null;
      gender: string | null;
      experience_level: string | null;
      points: number | null;
      level_code: string | null;
    }>(
      `SELECT u.id AS usuario_id,
              u.nombre_completo AS full_name,
              u.genero AS gender,
              p.objetivo,
              b.id AS branch_id,
              b.name AS branch_name,
              o.experience_level,
              c.id AS connection_id,
              c.status AS connection_status,
              c.requester_id,
              s.social_status,
              s.visible AS social_visible,
              ph.url AS photo_url,
              up.points,
              up.level_code
         FROM public.usuarios u
         LEFT JOIN public.perfiles_antropometricos p ON p.usuario_id = u.id
         LEFT JOIN profile.onboarding o ON o.user_id = u.id
         -- La sucursal se resuelve sólo si pertenece al mismo gimnasio que se
         -- está mirando. usuarios.sede_id es un UUID suelto: nada impide que
         -- apunte a una sede que hoy es de otra marca (las sedes de demostración
         -- vivieron un tiempo bajo un único tenant). Sin esta condición, el
         -- directorio de un gimnasio muestra el nombre de la sucursal de un
         -- competidor; con ella, esa referencia cruzada se degrada a nula.
         LEFT JOIN facilities.branches b
           ON b.id = u.sede_id
          AND COALESCE(b.tenant_id, :defaultTenantId) = :tenantId
         LEFT JOIN progression.user_progress up ON up.usuario_id = u.id
         LEFT JOIN social.connections c
           ON c.status <> 'REJECTED'
          AND ((c.requester_id = u.id AND c.addressee_id = :viewerId)
            OR (c.addressee_id = u.id AND c.requester_id = :viewerId))
         LEFT JOIN social.profile_settings s ON s.user_id = u.id
         LEFT JOIN LATERAL (
           SELECT url FROM profile.photos ph
            WHERE ph.user_id = u.id
            ORDER BY ph.position ASC
            LIMIT 1
         ) ph ON true
        WHERE u.id <> :viewerId
          AND u.estado = 'ACTIVO'
          AND COALESCE(u.tenant_id, :defaultTenantId) = :tenantId
          AND (:objetivo::text IS NULL OR p.objetivo = :objetivo)
          AND (:branchId::uuid IS NULL OR u.sede_id = :branchId)
          AND (:gender::text IS NULL OR u.genero = :gender)
          AND (:search::text IS NULL OR u.nombre_completo ILIKE :search)
          AND (:targetUserId::uuid IS NULL OR u.id = :targetUserId)
          AND (NOT :excludeDecided::boolean
            OR (NOT EXISTS (
                  SELECT 1 FROM social.connections dc
                   WHERE (dc.requester_id = u.id AND dc.addressee_id = :viewerId)
                      OR (dc.addressee_id = u.id AND dc.requester_id = :viewerId))
               AND NOT EXISTS (
                  SELECT 1 FROM social.discovery_passes dp
                   WHERE dp.viewer_id = :viewerId AND dp.target_id = u.id)))
        ORDER BY ${orderBy}
        LIMIT :limit`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          viewerId,
          tenantId,
          defaultTenantId,
          objetivo: filters.objetivo ?? null,
          branchId: filters.branchId ?? null,
          gender: filters.gender ?? null,
          search: filters.search ? `%${escapeLikePattern(filters.search)}%` : null,
          targetUserId: filters.targetUserId ?? null,
          excludeDecided: filters.excludeDecided ?? false,
          limit: filters.limit,
        },
      },
    );

    return rows.map((row) => {
      const connectionStatus =
        !row.connection_status
          ? ("NONE" as const)
          : row.connection_status === "ACCEPTED"
            ? ("ACCEPTED" as const)
            : row.requester_id === viewerId
              ? ("PENDING_SENT" as const)
              : ("PENDING_RECEIVED" as const);
      return {
        userId: row.usuario_id,
        fullName: row.full_name,
        objetivo: row.objetivo,
        branchId: row.branch_id,
        branchName: row.branch_name,
        connectionId: row.connection_id,
        connectionStatus,
        // Misma regla que `SocialService.viewSocialStatus`: solo conexión
        // aceptada y visibilidad activada por la propia persona.
        socialStatus: connectionStatus === "ACCEPTED" && row.social_visible ? row.social_status : null,
        photoUrl: row.photo_url,
        gender: row.gender,
        experienceLevel: row.experience_level,
        points: row.points,
        levelCode: row.level_code,
      };
    });
  }
}
