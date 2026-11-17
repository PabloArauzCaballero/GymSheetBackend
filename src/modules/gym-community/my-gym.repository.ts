import { Injectable } from "@nestjs/common";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { personAccountSql } from "../../common/sql/person-accounts";

/** A live SOCIO row of the person (REQUESTED or CONFIRMED) with its gym and declared location. */
export type LiveSocioRow = {
  affiliationId: string;
  status: "REQUESTED" | "CONFIRMED";
  requestedAt: Date;
  confirmedAt: Date | null;
  replacesAffiliationId: string | null;
  gymId: string;
  gymName: string;
  gymHandle: string | null;
  gymLogoUrl: string | null;
  locationId: string | null;
  locationName: string | null;
};

export type LeaderboardRow = {
  userId: string;
  fullName: string;
  points: number;
  levelCode: string | null;
  currentStreakDays: number;
  photoUrl: string | null;
  badges: Array<{ code: string; name: string; icon: string; color: string; rarity?: string }>;
};

/**
 * SQL: the person aliased `alias` shows their gym membership to others. No
 * settings row means the default (shown). The alias is code, never input.
 */
export function gymMembershipVisibleSql(alias: string): string {
  return `COALESCE((SELECT vs.gym_membership_visible FROM social.profile_settings vs WHERE vs.user_id = ${alias}.id), true)`;
}

/**
 * Reads of «Mi gimnasio» (ADR-0027). The gym of a person is their single
 * CONFIRMED SOCIO affiliation, never `usuarios.tenant_id`.
 */
@Injectable()
export class MyGymRepository {
  constructor(private readonly sequelize: Sequelize) {}

  /**
   * The person's live SOCIO rows: at most one CONFIRMED and one REQUESTED
   * (`ux_affiliations_confirmed_socio`, `ux_affiliations_requested_socio`).
   */
  liveSocio(userId: string): Promise<LiveSocioRow[]> {
    return this.sequelize.query<LiveSocioRow>(
      `SELECT a.id AS "affiliationId", a.status, a.requested_at AS "requestedAt", a.confirmed_at AS "confirmedAt",
              a.replaces_affiliation_id AS "replacesAffiliationId",
              g.id AS "gymId", g.name AS "gymName", gh.handle AS "gymHandle", g.logo_url AS "gymLogoUrl",
              l.id AS "locationId", l.name AS "locationName"
         FROM directory.affiliations a
         JOIN directory.entities g ON g.id = a.gym_entity_id
         LEFT JOIN directory.handles gh ON gh.owner_entity_id = g.id AND gh.status = 'ACTIVE'
         LEFT JOIN directory.entity_locations l ON l.id = a.location_id
        WHERE a.user_id = :userId AND a.kind = 'SOCIO' AND a.status IN ('REQUESTED', 'CONFIRMED')`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
  }

  /** The gym entity of the person's CONFIRMED SOCIO, one probe on `ux_affiliations_confirmed_socio`. */
  async confirmedGymOf(userId: string): Promise<string | null> {
    const [row] = await this.sequelize.query<{ gymEntityId: string }>(
      `SELECT gym_entity_id AS "gymEntityId" FROM directory.affiliations
        WHERE user_id = :userId AND kind = 'SOCIO' AND status = 'CONFIRMED'`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return row?.gymEntityId ?? null;
  }

  async membershipVisible(userId: string): Promise<boolean> {
    const [row] = await this.sequelize.query<{ visible: boolean }>(
      `SELECT ${gymMembershipVisibleSql("u")} AS visible FROM public.usuarios u WHERE u.id = :userId`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return row?.visible ?? true;
  }

  async setMembershipVisible(userId: string, visible: boolean): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO social.profile_settings (user_id, gym_membership_visible) VALUES (:userId, :visible)
       ON CONFLICT (user_id) DO UPDATE SET gym_membership_visible = EXCLUDED.gym_membership_visible, updated_at = now()`,
      { replacements: { userId, visible } },
    );
  }

  /**
   * The ranking of one gym: its CONFIRMED SOCIOs read from
   * `ix_affiliations_gym_confirmed`, then their progress by primary key.
   * Whoever hides their membership is left out (the viewer always sees
   * themselves). A block in either direction hides the photo, not the place.
   * The streak order breaks ties by points.
   */
  leaderboard(gymEntityId: string, viewerId: string, limit: number, sortBy: "points" | "streak"): Promise<LeaderboardRow[]> {
    const orderBy = sortBy === "streak" ? "p.current_streak_days DESC, p.points DESC" : "p.points DESC, p.current_streak_days DESC";
    return this.sequelize.query<LeaderboardRow>(
      `SELECT p.usuario_id AS "userId", u.nombre_completo AS "fullName", p.points, p.level_code AS "levelCode",
              p.current_streak_days AS "currentStreakDays",
              (SELECT ph.url FROM profile.photos ph
                WHERE ph.user_id = p.usuario_id AND ph.hidden_at IS NULL
                  AND NOT EXISTS (SELECT 1 FROM social.user_blocks b
                                   WHERE (b.blocker_id = p.usuario_id AND b.blocked_id = :viewerId)
                                      OR (b.blocker_id = :viewerId AND b.blocked_id = p.usuario_id))
                ORDER BY ph.position ASC, ph.created_at ASC LIMIT 1) AS "photoUrl",
              COALESCE((SELECT json_agg(json_build_object('code', t.code, 'name', t.name, 'icon', t.icon, 'color', t.color, 'rarity', t.rarity)
                                        ORDER BY t.awarded_at DESC)
                          FROM (SELECT b.code, b.name, b.icon, b.color, b.rarity, ub.awarded_at
                                  FROM progression.user_badges ub JOIN progression.badges b ON b.id = ub.badge_id
                                 WHERE ub.usuario_id = p.usuario_id ORDER BY ub.awarded_at DESC LIMIT 3) t), '[]'::json) AS "badges"
         FROM directory.affiliations a
         JOIN public.usuarios u ON u.id = a.user_id
         JOIN progression.user_progress p ON p.usuario_id = a.user_id
        WHERE a.gym_entity_id = :gymEntityId AND a.kind = 'SOCIO' AND a.status = 'CONFIRMED'
          AND u.estado = 'ACTIVO' AND ${personAccountSql("u")}
          AND (u.id = :viewerId OR ${gymMembershipVisibleSql("u")})
          AND p.points > 0
        ORDER BY ${orderBy}, p.usuario_id
        LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { gymEntityId, viewerId, limit } },
    );
  }
}
