import { Injectable, Optional } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { Op, QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ConnectionStatus } from "../../common/enums/domain.enums";
import { ConnectionModel } from "./connection.model";
import { DiscoveryPassModel } from "./discovery-pass.model";
import { ProfileSocialSettingsModel } from "./profile-social-settings.model";
import { lockSocialPairUsers } from "./social-pair-lock";
import type { SocialDiscoverySettings } from "./social-discovery-settings.policy";
import type { DiscoveryPreferencesInput } from "./social.schemas";
import { SocialRecommendationOutboxService } from "./social-recommendation-outbox.service";

export interface DiscoveryPreferences {
  configured: true;
  genders: ("MALE" | "FEMALE")[];
  intents: ("TRAINING" | "FRIENDSHIP" | "DATING")[];
  minAge: number;
  maxAge: number;
  radiusKm: number;
  flexibleAge: boolean;
  flexibleDistance: boolean;
  version: number;
}

export interface DiscoveryViewerContext {
  age: number;
  gender: string;
  goal: string | null;
  area: { lat: number; lon: number };
}

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
  /**
   * La galería completa, ordenada por `position` y acotada al tope de producto
   * (6, `ProfilePhotosService.MAX_PHOTOS_PER_USER`).
   *
   * `photoUrl` sigue siendo la primera de esta lista y no se retira: hay
   * consumidores vivos en web y móvil que la leen.
   */
  photos: { id: string; url: string }[];
  /** Años, calculados desde `fecha_nacimiento` (o `edad` en perfiles antiguos). Nulo si no hay ninguno. */
  age: number | null;
  gender: string | null;
  experienceLevel: string | null;
  points: number | null;
  levelCode: string | null;
  /** Public gym coordinates and declared discovery intent, internal to ranking only. */
  recommendationArea?: { lat: number; lon: number } | null;
  recommendationIntents?: string[];
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
  genders?: readonly string[];
  minAge?: number;
  maxAge?: number;
  search?: string;
  limit: number;
  /** Restringe la consulta a una sola persona (perfil individual). */
  targetUserId?: string;
  /**
   * Restringe la consulta a un conjunto concreto de personas.
   *
   * Es lo que permite que «quién me dio like» y «quién me dio next» pinten la
   * misma ficha que la baraja sin reescribir su SQL: la pantalla resuelve
   * primero los ids de la interacción y pide aquí las fichas de golpe, no una
   * por una. Un array vacío no consulta nada (ver la guarda de `directory`).
   */
  userIds?: readonly string[];
  /**
   * Baraja: fuera quien ya tiene conexión en cualquier estado (incluido
   * `REJECTED`) y quien el viewer ya descartó.
   */
  excludeDecided?: boolean;
  /** Add adults from other tenants who explicitly enabled cross-gym discovery. */
  includeCrossGym?: boolean;
  /** Map directory: candidates must still have map and profile consent. */
  mapOnly?: boolean;
  discoveryOnly?: boolean;
  /** Map directory: never return an account without a verified adult age. */
  adultOnly?: boolean;
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

/**
 * Un «me gusta» todavía sin responder, visto desde una de las dos puntas.
 *
 * `userId` es siempre la otra persona —quien lo envió en «recibidos», a quien
 * se lo envié en «enviados»—, para que quien consume la lista no tenga que
 * volver a preguntarse de qué lado está.
 */
export interface LikeInteractionRow {
  userId: string;
  connectionId: string;
  likedAt: Date;
}

/** Un descarte de la baraja, visto desde una de las dos puntas. */
export interface PassInteractionRow {
  userId: string;
  passedAt: Date;
}

/** Los cinco contadores de la cabecera de interacciones. */
export interface InteractionCountsRow {
  likesReceived: number;
  likesSent: number;
  passesReceived: number;
  passesSent: number;
  profileViewsNew: number;
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
    @Optional()
    private readonly recommendationOutbox?: SocialRecommendationOutboxService,
  ) {}

  /** Ejecuta `work` dentro de una transacción propia. */
  runInTransaction<T>(
    work: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    return this.sequelize.transaction(work);
  }

  async lockSocialPair(
    userA: string,
    userB: string,
    transaction: Transaction,
  ): Promise<void> {
    await lockSocialPairUsers(this.sequelize, userA, userB, transaction);
  }

  async isBlockedEitherWay(
    userA: string,
    userB: string,
    transaction?: Transaction,
  ): Promise<boolean> {
    const rows = await this.sequelize.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM social.user_blocks
          WHERE (blocker_id = :userA AND blocked_id = :userB)
             OR (blocker_id = :userB AND blocked_id = :userA)
       ) AS blocked`,
      { type: QueryTypes.SELECT, replacements: { userA, userB }, transaction },
    );
    return rows[0]?.blocked === true;
  }

  async blockUser(blockerId: string, blockedId: string): Promise<string[]> {
    return this.sequelize.transaction(async (transaction) => {
      await this.lockSocialPair(blockerId, blockedId, transaction);
      await this.sequelize.query(
        `INSERT INTO social.user_blocks (blocker_id, blocked_id)
         VALUES (:blockerId, :blockedId) ON CONFLICT DO NOTHING`,
        { replacements: { blockerId, blockedId }, transaction },
      );
      const conversations = await this.sequelize.query<{
        conversation_id: string;
      }>(
        `SELECT c.id AS conversation_id
           FROM chat.conversations c
           JOIN chat.participants p1 ON p1.conversation_id = c.id AND p1.user_id = :blockerId
           JOIN chat.participants p2 ON p2.conversation_id = c.id AND p2.user_id = :blockedId
          WHERE c.revoked_at IS NULL
            AND c.system_kind IS NULL
            AND (SELECT COUNT(*) FROM chat.participants p3 WHERE p3.conversation_id = c.id) = 2
          FOR UPDATE OF c`,
        {
          type: QueryTypes.SELECT,
          replacements: { blockerId, blockedId },
          transaction,
        },
      );
      const conversationIds = conversations.map((row) => row.conversation_id);
      if (conversationIds.length) {
        await this.sequelize.query(
          `UPDATE chat.conversations SET revoked_at = NOW(), revoked_by_user_id = :blockerId
            WHERE id IN (:conversationIds)`,
          { replacements: { blockerId, conversationIds }, transaction },
        );
      }
      await this.sequelize.query(
        `DELETE FROM social.connections
          WHERE (requester_id = :blockerId AND addressee_id = :blockedId)
             OR (requester_id = :blockedId AND addressee_id = :blockerId)`,
        { replacements: { blockerId, blockedId }, transaction },
      );
      await this.sequelize.query(
        `DELETE FROM social.discovery_passes
          WHERE (viewer_id = :blockerId AND target_id = :blockedId)
             OR (viewer_id = :blockedId AND target_id = :blockerId)`,
        { replacements: { blockerId, blockedId }, transaction },
      );
      return conversationIds;
    });
  }

  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    await this.sequelize.query(
      `DELETE FROM social.user_blocks WHERE blocker_id = :blockerId AND blocked_id = :blockedId`,
      { replacements: { blockerId, blockedId }, type: QueryTypes.DELETE },
    );
  }

  async listBlockedUsers(
    blockerId: string,
  ): Promise<{ userId: string; displayName: string; blockedAt: Date }[]> {
    const rows = await this.sequelize.query<{
      blocked_id: string;
      full_name: string;
      created_at: Date;
    }>(
      `SELECT block.blocked_id, account.nombre_completo AS full_name, block.created_at
         FROM social.user_blocks block
         JOIN public.usuarios account ON account.id = block.blocked_id
        WHERE block.blocker_id = :blockerId ORDER BY block.created_at DESC`,
      { replacements: { blockerId }, type: QueryTypes.SELECT },
    );
    return rows.map((row) => ({
      userId: row.blocked_id,
      displayName: row.full_name,
      blockedAt: row.created_at,
    }));
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
    lock = true,
  ): Promise<ConnectionModel | null> {
    return this.connections.findOne({
      where: {
        id,
        [Op.or]: [{ requesterId: userId }, { addresseeId: userId }],
      },
      transaction,
      ...(transaction && lock ? { lock: transaction.LOCK.UPDATE } : {}),
    });
  }

  /** Atomically removes a connection and revokes every exact 1:1 chat attached to it. */
  async revokeConnection(
    connectionId: string,
    userId: string,
  ): Promise<{ conversationIds: string[] } | null> {
    return this.sequelize.transaction(async (transaction) => {
      // Discover the pair without taking the connection lock, then serialize all
      // operations for that pair before locking the connection/conversation rows.
      const candidate = await this.findByIdForUser(
        connectionId,
        userId,
        transaction,
        false,
      );
      if (!candidate) return null;
      if (
        candidate.status === ConnectionStatus.PENDING &&
        candidate.requesterId !== userId
      )
        return null;
      if (
        candidate.status !== ConnectionStatus.PENDING &&
        candidate.status !== ConnectionStatus.ACCEPTED
      )
        return null;
      await this.lockSocialPair(
        candidate.requesterId,
        candidate.addresseeId,
        transaction,
      );
      const connection = await this.findByIdForUser(
        connectionId,
        userId,
        transaction,
      );
      if (!connection) return null;
      if (
        connection.status === ConnectionStatus.PENDING &&
        connection.requesterId !== userId
      )
        return null;
      if (
        connection.status !== ConnectionStatus.PENDING &&
        connection.status !== ConnectionStatus.ACCEPTED
      )
        return null;

      let conversationIds: string[] = [];
      if (connection.status === ConnectionStatus.ACCEPTED) {
        const conversations = await this.sequelize.query<{
          conversation_id: string;
        }>(
          `SELECT c.id AS conversation_id
             FROM chat.conversations c
             JOIN chat.participants p1 ON p1.conversation_id = c.id AND p1.user_id = :requesterId
             JOIN chat.participants p2 ON p2.conversation_id = c.id AND p2.user_id = :addresseeId
            WHERE c.revoked_at IS NULL
              AND c.system_kind IS NULL
              AND (SELECT COUNT(*) FROM chat.participants p3 WHERE p3.conversation_id = c.id) = 2
            FOR UPDATE OF c`,
          {
            type: QueryTypes.SELECT,
            replacements: {
              requesterId: connection.requesterId,
              addresseeId: connection.addresseeId,
            },
            transaction,
          },
        );
        conversationIds = conversations.map((row) => row.conversation_id);
        if (conversationIds.length) {
          await this.sequelize.query(
            `UPDATE chat.conversations
                SET revoked_at = NOW(), revoked_by_user_id = :userId
              WHERE id IN (:conversationIds) AND revoked_at IS NULL`,
            { replacements: { userId, conversationIds }, transaction },
          );
        }

        const futureInvites = await this.sequelize.query<{ id: string }>(
          `SELECT i.id
             FROM training.training_invites i
             JOIN training.training_invite_meetings m ON m.invite_id = i.id
            WHERE i.state = 'ACCEPTED'
              AND i.responded_revision = i.current_revision
              AND m.accepted_revision = i.responded_revision
              AND m.starts_at > clock_timestamp()
              AND ((i.inviter_id = :requesterId AND i.recipient_id = :addresseeId)
                OR (i.inviter_id = :addresseeId AND i.recipient_id = :requesterId))
            FOR UPDATE OF i, m`,
          {
            type: QueryTypes.SELECT,
            replacements: {
              requesterId: connection.requesterId,
              addresseeId: connection.addresseeId,
            },
            transaction,
          },
        );
        const futureInviteIds = futureInvites.map((row) => row.id);
        if (futureInviteIds.length) {
          await this.sequelize.query(
            `UPDATE training.training_invites
                SET state = 'CANCELLED', updated_at = clock_timestamp()
              WHERE id IN (:inviteIds) AND state = 'ACCEPTED'`,
            { replacements: { inviteIds: futureInviteIds }, transaction },
          );
          await this.sequelize.query(
            `UPDATE training.training_invite_meetings
                SET cancelled_at = clock_timestamp()
              WHERE invite_id IN (:inviteIds) AND cancelled_at IS NULL`,
            { replacements: { inviteIds: futureInviteIds }, transaction },
          );
        }

        // A pending proposal is no longer actionable after the pair breaks.
        // Keep its revisions and command history, but remove it from the
        // partial unique index so a later reconnection can start fresh.
        await this.sequelize.query(
          `UPDATE training.training_invites
              SET state = 'CANCELLED', updated_at = clock_timestamp()
            WHERE state = 'PENDING'
              AND ((inviter_id = :requesterId AND recipient_id = :addresseeId)
                OR (inviter_id = :addresseeId AND recipient_id = :requesterId))`,
          {
            replacements: {
              requesterId: connection.requesterId,
              addresseeId: connection.addresseeId,
            },
            transaction,
          },
        );
      }
      await connection.destroy({ transaction });
      return { conversationIds };
    });
  }

  async listForUser(
    userId: string,
    status?: ConnectionStatus,
  ): Promise<ConnectionModel[]> {
    return this.connections.findAll({
      where: {
        [Op.or]: [{ requesterId: userId }, { addresseeId: userId }],
        ...(status ? { status } : {}),
      },
      order: [["createdAt", "DESC"]],
    });
  }

  /** Nombres de la otra parte de cada conexión, en un solo viaje a la base. */
  async namesFor(
    userIds: readonly string[],
    transaction?: Transaction,
  ): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.sequelize.query<{
      id: string;
      nombre_completo: string;
    }>(`SELECT id, nombre_completo FROM public.usuarios WHERE id IN (:ids)`, {
      type: QueryTypes.SELECT,
      replacements: { ids: userIds },
      transaction,
    });
    return new Map(rows.map((row) => [row.id, row.nombre_completo]));
  }

  async respond(
    connection: ConnectionModel,
    status: ConnectionStatus,
    transaction?: Transaction,
  ): Promise<ConnectionModel> {
    await connection.update(
      { status, respondedAt: new Date() },
      { transaction },
    );
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

  /** Both sides must be active adults who explicitly opened cross-gym discovery. */
  async canInteractAcrossTenants(
    viewerId: string,
    targetId: string,
    transaction?: Transaction,
  ): Promise<boolean> {
    const rows = await this.sequelize.query<{ allowed: boolean }>(
      `SELECT COUNT(DISTINCT u.id) = 2
                AND BOOL_AND(u.estado = 'ACTIVO'
                  AND COALESCE(EXTRACT(YEAR FROM age(CURRENT_DATE, p.fecha_nacimiento))::int, p.edad, 0) >= 18
                  AND s.profile_enabled
                  AND s.cross_gym_enabled) AS allowed
         FROM public.usuarios u
         JOIN social.profile_settings s ON s.user_id = u.id
         LEFT JOIN public.perfiles_antropometricos p ON p.usuario_id = u.id
        WHERE u.id IN (:viewerId, :targetId)`,
      {
        type: QueryTypes.SELECT,
        replacements: { viewerId, targetId },
        transaction,
      },
    );
    return rows[0]?.allowed === true;
  }

  async discoverySettings(userId: string): Promise<SocialDiscoverySettings> {
    const rows = await this.sequelize.query<SocialDiscoverySettings>(
      `SELECT profile_enabled AS "profileEnabled",
              cross_gym_enabled AS "crossGymEnabled",
              map_enabled AS "mapEnabled",
              version
         FROM social.profile_settings
        WHERE user_id = :userId`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return (
      rows[0] ?? {
        profileEnabled: false,
        crossGymEnabled: false,
        mapEnabled: false,
        version: 0,
      }
    );
  }

  async discoveryPreferences(
    userId: string,
  ): Promise<DiscoveryPreferences | { configured: false; version: 0 }> {
    const rows = await this.sequelize.query<
      Omit<DiscoveryPreferences, "configured"> & { radiusKm: number | string }
    >(
      `SELECT genders, intents, min_age AS "minAge", max_age AS "maxAge",
              radius_km AS "radiusKm", flexible_age AS "flexibleAge",
              flexible_distance AS "flexibleDistance", version
         FROM social.discovery_preferences WHERE user_id = :userId`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    const row = rows[0];
    return row
      ? { ...row, configured: true, radiusKm: Number(row.radiusKm) }
      : { configured: false, version: 0 };
  }

  async discoveryViewerContext(
    userId: string,
  ): Promise<DiscoveryViewerContext | null> {
    const rows = await this.sequelize.query<{
      age: number | null;
      gender: string | null;
      goal: string | null;
      lat: number | null;
      lon: number | null;
    }>(
      `SELECT COALESCE(EXTRACT(YEAR FROM age(CURRENT_DATE, profile.fecha_nacimiento))::int, profile.edad) AS age,
              account.genero AS gender, profile.objetivo AS goal,
              branch.latitude::float8 AS lat, branch.longitude::float8 AS lon
         FROM public.usuarios account
         LEFT JOIN public.perfiles_antropometricos profile ON profile.usuario_id = account.id
         LEFT JOIN facilities.branches branch ON branch.id = account.sede_id AND branch.status = 'ACTIVE'
        WHERE account.id = :userId AND account.estado = 'ACTIVO'
          AND (account.suspended_until IS NULL OR account.suspended_until <= NOW())`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    const row = rows[0];
    if (
      !row ||
      !Number.isInteger(row.age) ||
      (row.age as number) < 18 ||
      row.lat === null ||
      row.lon === null
    )
      return null;
    return {
      age: row.age as number,
      gender: row.gender ?? "UNSPECIFIED",
      goal: row.goal,
      area: { lat: row.lat, lon: row.lon },
    };
  }

  async updateDiscoveryPreferences(
    userId: string,
    input: DiscoveryPreferencesInput,
  ): Promise<DiscoveryPreferences | null> {
    return this.sequelize.transaction(async (transaction) => {
      const users = await this.sequelize.query<{ id: string }>(
        `SELECT id FROM public.usuarios WHERE id = :userId FOR UPDATE`,
        { type: QueryTypes.SELECT, replacements: { userId }, transaction },
      );
      if (!users.length) return null;
      const rows = await this.sequelize.query<DiscoveryPreferences>(
        `INSERT INTO social.discovery_preferences
           (user_id, genders, intents, min_age, max_age, radius_km, flexible_age, flexible_distance, version)
         VALUES (:userId, ARRAY(SELECT jsonb_array_elements_text(CAST(:gendersJson AS jsonb))),
                 ARRAY(SELECT jsonb_array_elements_text(CAST(:intentsJson AS jsonb))),
                 :minAge, :maxAge, :radiusKm, :flexibleAge, :flexibleDistance, 1)
         ON CONFLICT (user_id) DO UPDATE SET
           genders = EXCLUDED.genders, intents = EXCLUDED.intents,
           min_age = EXCLUDED.min_age, max_age = EXCLUDED.max_age,
           radius_km = EXCLUDED.radius_km, flexible_age = EXCLUDED.flexible_age,
           flexible_distance = EXCLUDED.flexible_distance,
           version = social.discovery_preferences.version + 1, updated_at = NOW()
         WHERE social.discovery_preferences.version = :expectedVersion
           AND :expectedVersion > 0
         RETURNING genders, intents, min_age AS "minAge", max_age AS "maxAge",
                   radius_km AS "radiusKm", flexible_age AS "flexibleAge",
                   flexible_distance AS "flexibleDistance", version`,
        {
          type: QueryTypes.SELECT,
          replacements: {
            userId,
            ...input,
            gendersJson: JSON.stringify(input.genders),
            intentsJson: JSON.stringify(input.intents),
          },
          transaction,
        },
      );
      if (!rows.length && input.expectedVersion === 0) {
        const inserted = await this.sequelize.query<DiscoveryPreferences>(
          `INSERT INTO social.discovery_preferences
             (user_id, genders, intents, min_age, max_age, radius_km, flexible_age, flexible_distance, version)
           VALUES (:userId, ARRAY(SELECT jsonb_array_elements_text(CAST(:gendersJson AS jsonb))),
                   ARRAY(SELECT jsonb_array_elements_text(CAST(:intentsJson AS jsonb))),
                   :minAge, :maxAge, :radiusKm, :flexibleAge, :flexibleDistance, 1)
           ON CONFLICT (user_id) DO NOTHING
           RETURNING genders, intents, min_age AS "minAge", max_age AS "maxAge",
                     radius_km AS "radiusKm", flexible_age AS "flexibleAge",
                     flexible_distance AS "flexibleDistance", version`,
          {
            type: QueryTypes.SELECT,
            replacements: {
              userId,
              ...input,
              gendersJson: JSON.stringify(input.genders),
              intentsJson: JSON.stringify(input.intents),
            },
            transaction,
          },
        );
        if (inserted[0]) {
          await this.recommendationOutbox?.enqueueProfileSnapshot(
            userId,
            transaction,
          );
          return {
            ...inserted[0],
            configured: true,
            radiusKm: Number(inserted[0].radiusKm),
          };
        }
      }
      if (!rows[0]) return null;
      await this.recommendationOutbox?.enqueueProfileSnapshot(
        userId,
        transaction,
      );
      return {
        ...rows[0],
        configured: true,
        radiusKm: Number(rows[0].radiusKm),
      };
    });
  }

  async updateDiscoverySettings(
    userId: string,
    settings: SocialDiscoverySettings,
    expectedVersion: number,
  ): Promise<SocialDiscoverySettings | null> {
    return this.sequelize.transaction(async (transaction) => {
      const users = await this.sequelize.query<{ id: string }>(
        `SELECT id FROM public.usuarios WHERE id = :userId FOR UPDATE`,
        { type: QueryTypes.SELECT, replacements: { userId }, transaction },
      );
      if (!users.length) return null;
      await this.sequelize.query(
        `INSERT INTO social.profile_settings (user_id) VALUES (:userId)
         ON CONFLICT (user_id) DO NOTHING`,
        { replacements: { userId }, transaction },
      );
      const rows = await this.sequelize.query<SocialDiscoverySettings>(
        `UPDATE social.profile_settings
            SET profile_enabled = :profileEnabled,
                cross_gym_enabled = :crossGymEnabled,
                map_enabled = :mapEnabled,
                map_enabled_since = CASE WHEN :mapEnabled THEN NOW() ELSE NULL END,
                version = version + 1,
                updated_at = NOW()
          WHERE user_id = :userId AND version = :expectedVersion
          RETURNING profile_enabled AS "profileEnabled",
                    cross_gym_enabled AS "crossGymEnabled",
                    map_enabled AS "mapEnabled",
                    version`,
        {
          type: QueryTypes.SELECT,
          replacements: {
            userId,
            profileEnabled: settings.profileEnabled,
            crossGymEnabled: settings.crossGymEnabled,
            mapEnabled: settings.mapEnabled,
            expectedVersion,
          },
          transaction,
        },
      );
      if (!rows[0]) return null;
      await this.recommendationOutbox?.enqueueProfileSnapshot(
        userId,
        transaction,
      );
      return rows[0];
    });
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
  async createPass(
    viewerId: string,
    targetId: string,
    transaction?: Transaction,
  ): Promise<void> {
    await this.passes.bulkCreate([{ viewerId, targetId }] as never, {
      ignoreDuplicates: true,
      transaction,
    });
  }

  async deletePass(
    viewerId: string,
    targetId: string,
    transaction?: Transaction,
  ): Promise<number> {
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
  async findLastSwipe(
    viewerId: string,
    transaction?: Transaction,
  ): Promise<LastSwipeRow | null> {
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
      connectionStatus:
        (row.connection_status as ConnectionStatus | null) ?? null,
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
    // Pedir «las fichas de esta lista» cuando la lista está vacía no es un
    // caso de error, es la respuesta vacía: sin esta guarda el `IN ()` que se
    // generaría ni siquiera es SQL válido.
    if (filters.userIds && filters.userIds.length === 0) return [];

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
      photos: { id: string; url: string }[] | null;
      age: number | null;
      gender: string | null;
      experience_level: string | null;
      points: number | null;
      level_code: string | null;
      recommendation_lat: number | null;
      recommendation_lon: number | null;
      recommendation_intents: string[] | null;
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
              ph.items AS photos,
              COALESCE(EXTRACT(YEAR FROM age(CURRENT_DATE, p.fecha_nacimiento))::int, p.edad) AS age,
              up.points,
              up.level_code,
              rank_branch.latitude::float8 AS recommendation_lat,
              rank_branch.longitude::float8 AS recommendation_lon,
              candidate_preferences.intents AS recommendation_intents
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
         LEFT JOIN facilities.branches rank_branch
           ON rank_branch.id = u.sede_id AND rank_branch.status = 'ACTIVE'
         LEFT JOIN social.discovery_preferences candidate_preferences ON candidate_preferences.user_id = u.id
         LEFT JOIN progression.user_progress up ON up.usuario_id = u.id
         LEFT JOIN social.connections c
           ON c.status <> 'REJECTED'
          AND ((c.requester_id = u.id AND c.addressee_id = :viewerId)
            OR (c.addressee_id = u.id AND c.requester_id = :viewerId))
         LEFT JOIN social.profile_settings s ON s.user_id = u.id
         -- La galería entera, no sólo la portada: la tarjeta de descubrimiento
         -- pasa las fotos con el dedo, así que necesita todas. El LIMIT es el
         -- tope de producto (6) y va DENTRO del subselect: agregando primero y
         -- recortando después se traerían filas que luego se tiran.
         LEFT JOIN LATERAL (
           SELECT json_agg(
                    json_build_object('id', g.id, 'url', g.url)
                    ORDER BY g.position ASC, g.created_at ASC
                  ) AS items
             FROM (
               SELECT ph.id, ph.url, ph.position, ph.created_at
                 FROM profile.photos ph
                WHERE ph.user_id = u.id
                  -- Una foto retirada por moderación no vuelve a la baraja: es
                  -- justo la superficie donde más gente la vería.
                  AND ph.hidden_at IS NULL
                ORDER BY ph.position ASC, ph.created_at ASC
                LIMIT 6
             ) g
         ) ph ON true
        WHERE u.id <> :viewerId
          AND NOT EXISTS (
            SELECT 1 FROM social.user_blocks block
             WHERE (block.blocker_id = :viewerId AND block.blocked_id = u.id)
                OR (block.blocker_id = u.id AND block.blocked_id = :viewerId))
          AND u.estado = 'ACTIVO'
          AND (u.suspended_until IS NULL OR u.suspended_until <= NOW())
          AND (
            COALESCE(u.tenant_id, :defaultTenantId) = :tenantId
            OR (:includeCrossGym::boolean
              AND COALESCE(u.tenant_id, :defaultTenantId) <> :tenantId
              AND s.profile_enabled = true
              AND s.cross_gym_enabled = true
              AND COALESCE(EXTRACT(YEAR FROM age(CURRENT_DATE, p.fecha_nacimiento))::int, p.edad, 0) >= 18)
          )
          AND (:objetivo::text IS NULL OR p.objetivo = :objetivo)
          AND (:branchId::uuid IS NULL OR u.sede_id = :branchId)
          AND (:gender::text IS NULL OR u.genero = :gender)
          AND (jsonb_array_length(CAST(:gendersJson AS jsonb)) = 0 OR u.genero IN (
            SELECT jsonb_array_elements_text(CAST(:gendersJson AS jsonb))))
          AND (:minAge::integer IS NULL OR COALESCE(EXTRACT(YEAR FROM age(CURRENT_DATE, p.fecha_nacimiento))::int, p.edad) >= :minAge)
          AND (:maxAge::integer IS NULL OR COALESCE(EXTRACT(YEAR FROM age(CURRENT_DATE, p.fecha_nacimiento))::int, p.edad) <= :maxAge)
          AND (:search::text IS NULL OR u.nombre_completo ILIKE :search)
          AND (:targetUserId::uuid IS NULL OR u.id = :targetUserId)
          AND (NOT :hasUserIds::boolean OR u.id IN (:userIds))
          AND (NOT :mapOnly::boolean OR (s.profile_enabled = TRUE AND s.map_enabled = TRUE))
          AND (NOT :discoveryOnly::boolean OR s.profile_enabled = TRUE)
          AND (NOT :adultOnly::boolean OR COALESCE(EXTRACT(YEAR FROM age(CURRENT_DATE, p.fecha_nacimiento))::int, p.edad, 0) >= 18)
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
          gendersJson: JSON.stringify(filters.genders ?? []),
          minAge: filters.minAge ?? null,
          maxAge: filters.maxAge ?? null,
          search: filters.search
            ? `%${escapeLikePattern(filters.search)}%`
            : null,
          targetUserId: filters.targetUserId ?? null,
          hasUserIds: (filters.userIds?.length ?? 0) > 0,
          // El marcador tiene que existir aunque no se use: Sequelize sustituye
          // los `:nombre` antes de que Postgres vea la consulta, y un array
          // vacío escribiría `IN ()`. La guarda de arriba ya descartó ese caso.
          userIds: filters.userIds?.length ? filters.userIds : [null],
          excludeDecided: filters.excludeDecided ?? false,
          includeCrossGym: filters.includeCrossGym ?? false,
          mapOnly: filters.mapOnly ?? false,
          discoveryOnly: filters.discoveryOnly ?? false,
          adultOnly: filters.adultOnly ?? false,
          limit: filters.limit,
        },
      },
    );

    return rows.map((row) => {
      const photos = row.photos ?? [];
      const connectionStatus = !row.connection_status
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
        socialStatus:
          connectionStatus === "ACCEPTED" && row.social_visible
            ? row.social_status
            : null,
        // `json_agg` sin filas devuelve NULL, no un array vacío.
        photoUrl: photos[0]?.url ?? null,
        photos,
        age: row.age,
        gender: row.gender,
        experienceLevel: row.experience_level,
        points: row.points,
        levelCode: row.level_code,
        recommendationArea:
          row.recommendation_lat === null || row.recommendation_lon === null
            ? null
            : { lat: row.recommendation_lat, lon: row.recommendation_lon },
        recommendationIntents: row.recommendation_intents ?? [],
      };
    });
  }

  // ─────────────────────────────────────── quién me dio like, quién me dio next

  /**
   * Los «me gusta» pendientes de una punta, en ids y fechas.
   *
   * Devuelve identificadores, no fichas: la ficha la resuelve `directory()` en
   * una segunda consulta con `userIds`. Repetir aquí sus veinte columnas sería
   * mantener dos definiciones distintas de «qué se ve de una persona», y la
   * primera vez que se añadiera un campo al perfil una de las dos se quedaría
   * corta — que es exactamente lo que acaba de pasar con `photos` y `age`.
   *
   * `PENDING` y no cualquier estado: un like aceptado ya no es una solicitud
   * esperando respuesta, es una conexión, y vive en otra pantalla. Uno
   * rechazado tampoco vuelve a esta lista.
   */
  async listLikesReceived(
    viewerId: string,
    limit: number,
  ): Promise<LikeInteractionRow[]> {
    // `ix_connections_addressee (addressee_id, status)` sostiene este filtro.
    return this.listPendingLikes(
      `SELECT c.requester_id AS user_id, c.id AS connection_id, c.created_at AS liked_at
         FROM social.connections c
        WHERE c.addressee_id = :viewerId AND c.status = 'PENDING'
        ORDER BY c.created_at DESC
        LIMIT :limit`,
      viewerId,
      limit,
    );
  }

  async listLikesSent(
    viewerId: string,
    limit: number,
  ): Promise<LikeInteractionRow[]> {
    // `ix_connections_requester (requester_id, status)`.
    return this.listPendingLikes(
      `SELECT c.addressee_id AS user_id, c.id AS connection_id, c.created_at AS liked_at
         FROM social.connections c
        WHERE c.requester_id = :viewerId AND c.status = 'PENDING'
        ORDER BY c.created_at DESC
        LIMIT :limit`,
      viewerId,
      limit,
    );
  }

  /**
   * Las dos consultas de arriba difieren en una columna y un `WHERE`, así que
   * comparten el mapeo. El SQL llega como literal desde este mismo fichero —
   * nunca desde la petición— y los dos únicos valores variables van
   * parametrizados.
   */
  private async listPendingLikes(
    sql: string,
    viewerId: string,
    limit: number,
  ): Promise<LikeInteractionRow[]> {
    const rows = await this.sequelize.query<{
      user_id: string;
      connection_id: string;
      liked_at: Date;
    }>(sql, { type: QueryTypes.SELECT, replacements: { viewerId, limit } });

    return rows.map((row) => ({
      userId: row.user_id,
      connectionId: row.connection_id,
      likedAt: new Date(row.liked_at),
    }));
  }

  /** Quién descartó al viewer. Índice `ix_discovery_passes_target_recent`. */
  async listPassesReceived(
    viewerId: string,
    limit: number,
  ): Promise<PassInteractionRow[]> {
    return this.listPasses(
      `SELECT dp.viewer_id AS user_id, dp.created_at AS passed_at
         FROM social.discovery_passes dp
        WHERE dp.target_id = :viewerId
        ORDER BY dp.created_at DESC
        LIMIT :limit`,
      viewerId,
      limit,
    );
  }

  /** A quién descartó el viewer. Índice `ix_discovery_passes_viewer_recent`. */
  async listPassesSent(
    viewerId: string,
    limit: number,
  ): Promise<PassInteractionRow[]> {
    return this.listPasses(
      `SELECT dp.target_id AS user_id, dp.created_at AS passed_at
         FROM social.discovery_passes dp
        WHERE dp.viewer_id = :viewerId
        ORDER BY dp.created_at DESC
        LIMIT :limit`,
      viewerId,
      limit,
    );
  }

  private async listPasses(
    sql: string,
    viewerId: string,
    limit: number,
  ): Promise<PassInteractionRow[]> {
    const rows = await this.sequelize.query<{
      user_id: string;
      passed_at: Date;
    }>(sql, {
      type: QueryTypes.SELECT,
      replacements: { viewerId, limit },
    });

    return rows.map((row) => ({
      userId: row.user_id,
      passedAt: new Date(row.passed_at),
    }));
  }

  /**
   * Los cinco contadores, en un solo viaje.
   *
   * Cada subconsulta cuenta lo mismo que lista su endpoint, y por eso todas
   * unen con `public.usuarios`: una baja o alguien de otro gimnasio no aparece
   * en las listas, así que tampoco puede aparecer en el número — un badge de
   * «3 nuevos» que abre una pantalla con dos filas es un fallo, no un detalle.
   *
   * `profile_views` se lee con SQL directo y no pidiéndoselo al módulo de
   * vistas de perfil: ese módulo ya depende del social, y llamarlo desde aquí
   * cerraría el ciclo. Es el mismo criterio que `directConversationHasMessages`
   * usa con el chat.
   *
   * Los espectadores se cuentan `DISTINCT`: diez visitas de la misma persona
   * son una persona. El corte es `profile_views_checked_at`, y nulo —nunca
   * abrió la lista— cuenta todas, de ahí el `-infinity`.
   */
  async countInteractions(
    viewerId: string,
    tenantId: string,
    defaultTenantId: string,
  ): Promise<InteractionCountsRow> {
    const rows = await this.sequelize.query<{
      likes_received: string;
      likes_sent: string;
      passes_received: string;
      passes_sent: string;
      profile_views_new: string;
    }>(
      `SELECT
         (SELECT COUNT(*)
            FROM social.connections c
            JOIN public.usuarios ru ON ru.id = c.requester_id
           WHERE c.addressee_id = :viewerId
             AND c.status = 'PENDING'
             AND ru.estado = 'ACTIVO'
             AND COALESCE(ru.tenant_id, :defaultTenantId) = :tenantId) AS likes_received,
         (SELECT COUNT(*)
            FROM social.connections c
            JOIN public.usuarios au ON au.id = c.addressee_id
           WHERE c.requester_id = :viewerId
             AND c.status = 'PENDING'
             AND au.estado = 'ACTIVO'
             AND COALESCE(au.tenant_id, :defaultTenantId) = :tenantId) AS likes_sent,
         (SELECT COUNT(*)
            FROM social.discovery_passes dp
            JOIN public.usuarios vu ON vu.id = dp.viewer_id
           WHERE dp.target_id = :viewerId
             AND vu.estado = 'ACTIVO'
             AND COALESCE(vu.tenant_id, :defaultTenantId) = :tenantId) AS passes_received,
         (SELECT COUNT(*)
            FROM social.discovery_passes dp
            JOIN public.usuarios tu ON tu.id = dp.target_id
           WHERE dp.viewer_id = :viewerId
             AND tu.estado = 'ACTIVO'
             AND COALESCE(tu.tenant_id, :defaultTenantId) = :tenantId) AS passes_sent,
         (SELECT COUNT(DISTINCT pv.viewer_id)
            FROM profile.profile_views pv
            JOIN public.usuarios pu ON pu.id = pv.viewer_id
           WHERE pv.viewed_user_id = :viewerId
             AND pu.estado = 'ACTIVO'
             AND COALESCE(pu.tenant_id, :defaultTenantId) = :tenantId
             AND pv.viewed_at > COALESCE(
                   (SELECT ps.profile_views_checked_at
                      FROM social.profile_settings ps
                     WHERE ps.user_id = :viewerId),
                   '-infinity'::timestamptz)) AS profile_views_new`,
      {
        type: QueryTypes.SELECT,
        replacements: { viewerId, tenantId, defaultTenantId },
      },
    );

    // `COUNT(*)` vuelve como bigint y el driver lo entrega en texto: sin
    // `Number` el JSON llevaría comillas y el cliente pintaría "12" como texto.
    const row = rows[0];
    return {
      likesReceived: Number(row?.likes_received ?? 0),
      likesSent: Number(row?.likes_sent ?? 0),
      passesReceived: Number(row?.passes_received ?? 0),
      passesSent: Number(row?.passes_sent ?? 0),
      profileViewsNew: Number(row?.profile_views_new ?? 0),
    };
  }
}
