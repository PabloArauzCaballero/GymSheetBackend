import { Injectable } from "@nestjs/common";
import { Sequelize as BaseSequelize, QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ProfileAward, ProfileFacts, ProfileItemDefinition, hasMeaningfulBio } from "./profile-completion";

interface FactsRow {
  user_id: string;
  tenant_id: string | null;
  has_body_profile: boolean;
  has_birth_date: boolean;
  photo_count: string;
  bio: string | null;
  has_gender: boolean;
  has_experience_level: boolean;
  interest_count: string;
}

export interface UserProfileFacts {
  userId: string;
  tenantId: string | null;
  facts: ProfileFacts;
}

/**
 * Todo lo que mide el catálogo, en una consulta y para varias personas. Las
 * fotos ocultadas por moderación no cuentan: una foto retirada no completa
 * nada. La bio se lee en crudo y la juzga `hasMeaningfulBio`: un solo
 * predicado, el mismo para el servicio y para la migración que reconoce lo que
 * cada socio ya tenía (`202611150001-profile-completion-rewards`).
 */
export async function loadProfileFacts(
  sequelize: BaseSequelize,
  userIds: readonly string[],
  transaction?: Transaction,
): Promise<UserProfileFacts[]> {
  if (userIds.length === 0) return [];
  const rows = await sequelize.query<FactsRow>(
    `SELECT u.id AS user_id, u.tenant_id,
            EXISTS (SELECT 1 FROM public.perfiles_antropometricos p WHERE p.usuario_id = u.id) AS has_body_profile,
            EXISTS (SELECT 1 FROM public.perfiles_antropometricos p
                     WHERE p.usuario_id = u.id AND p.fecha_nacimiento IS NOT NULL) AS has_birth_date,
            (SELECT count(*) FROM profile.photos ph WHERE ph.user_id = u.id AND ph.hidden_at IS NULL) AS photo_count,
            u.bio,
            (u.genero IS NOT NULL) AS has_gender,
            EXISTS (SELECT 1 FROM profile.onboarding o
                     WHERE o.user_id = u.id AND o.experience_level IS NOT NULL) AS has_experience_level,
            coalesce((SELECT jsonb_array_length(o.training_preferences) FROM profile.onboarding o
                       WHERE o.user_id = u.id AND jsonb_typeof(o.training_preferences) = 'array'), 0) AS interest_count
       FROM public.usuarios u
      WHERE u.id IN (:userIds)`,
    { type: QueryTypes.SELECT, replacements: { userIds: [...userIds] }, transaction },
  );
  return rows.map((row) => ({
    userId: row.user_id,
    tenantId: row.tenant_id,
    facts: {
      hasBodyProfile: Boolean(row.has_body_profile),
      hasBirthDate: Boolean(row.has_birth_date),
      photoCount: Number(row.photo_count ?? 0),
      hasBio: hasMeaningfulBio(row.bio),
      hasGender: Boolean(row.has_gender),
      hasExperienceLevel: Boolean(row.has_experience_level),
      interestCount: Number(row.interest_count ?? 0),
    },
  }));
}

const NO_FACTS: ProfileFacts = {
  hasBodyProfile: false,
  hasBirthDate: false,
  photoCount: 0,
  hasBio: false,
  hasGender: false,
  hasExperienceLevel: false,
  interestCount: 0,
};

interface AwardRow {
  item_code: string;
  points: number;
  awarded_at: Date;
}

@Injectable()
export class ProfileCompletionRepository {
  constructor(private readonly sequelize: Sequelize) {}

  async loadFacts(userId: string): Promise<ProfileFacts> {
    const [row] = await loadProfileFacts(this.sequelize, [userId]);
    return row?.facts ?? NO_FACTS;
  }

  async listAwards(userId: string): Promise<ProfileAward[]> {
    const rows = await this.sequelize.query<AwardRow>(
      `SELECT item_code, points, awarded_at
         FROM progression.profile_completion_awards
        WHERE user_id = :userId
        ORDER BY awarded_at, item_code`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return rows.map((row) => ({ itemCode: row.item_code, points: row.points, awardedAt: new Date(row.awarded_at) }));
  }

  /**
   * Anota los datos recién completados. La clave primaria `(user_id, item_code)`
   * y `ON CONFLICT DO NOTHING` hacen el premio idempotente incluso con dos
   * lecturas en paralelo: la segunda no inserta nada. Devuelve lo que entró.
   */
  async award(userId: string, tenantId: string | null, items: readonly ProfileItemDefinition[]): Promise<string[]> {
    if (items.length === 0) return [];
    const inserted = await this.sequelize.query<{ item_code: string }>(
      `INSERT INTO progression.profile_completion_awards (user_id, item_code, points, tenant_id)
       SELECT :userId, item.code, item.points, :tenantId
         FROM jsonb_to_recordset(CAST(:items AS jsonb)) AS item(code text, points integer)
       ON CONFLICT (user_id, item_code) DO NOTHING
       RETURNING item_code`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          userId,
          tenantId,
          items: JSON.stringify(items.map((item) => ({ code: item.code, points: item.points }))),
        },
      },
    );
    return inserted.map((row) => row.item_code);
  }
}
