import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { Op, QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ConnectionStatus } from "../../common/enums/domain.enums";
import { ConnectionModel } from "./connection.model";
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

@Injectable()
export class SocialRepository {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(ConnectionModel)
    private readonly connections: typeof ConnectionModel,
    @InjectModel(ProfileSocialSettingsModel)
    private readonly settings: typeof ProfileSocialSettingsModel,
  ) {}

  /** Cualquier conexión no rechazada entre dos usuarios, en cualquier dirección. */
  findActiveBetween(userA: string, userB: string): Promise<ConnectionModel | null> {
    return this.connections.findOne({
      where: {
        status: { [Op.ne]: ConnectionStatus.REJECTED },
        [Op.or]: [
          { requesterId: userA, addresseeId: userB },
          { requesterId: userB, addresseeId: userA },
        ],
      },
    });
  }

  create(requesterId: string, addresseeId: string): Promise<ConnectionModel> {
    return this.connections.create({ requesterId, addresseeId, status: ConnectionStatus.PENDING });
  }

  findByIdForUser(id: string, userId: string): Promise<ConnectionModel | null> {
    return this.connections.findOne({
      where: { id, [Op.or]: [{ requesterId: userId }, { addresseeId: userId }] },
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

  async respond(connection: ConnectionModel, status: ConnectionStatus): Promise<ConnectionModel> {
    await connection.update({ status, respondedAt: new Date() });
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

  /**
   * El directorio del gimnasio: otros socios, con el estado de conexión visto
   * desde quien pregunta. `usuario_id <> :viewerId` se hace en SQL para no
   * traer a la propia cuenta y descartarla después.
   */
  async directory(
    viewerId: string,
    tenantId: string,
    defaultTenantId: string,
    filters: { objetivo?: string; branchId?: string; gender?: string; search?: string; limit: number },
  ): Promise<DirectoryRow[]> {
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
         LEFT JOIN facilities.branches b ON b.id = u.sede_id
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
        ORDER BY u.nombre_completo ASC
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
