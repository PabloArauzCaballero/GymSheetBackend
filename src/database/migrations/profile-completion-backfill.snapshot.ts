import { QueryTypes, Sequelize, Transaction } from "sequelize";

/**
 * Frozen copy of the profile-completion predicates as they stood on 2026-11-15,
 * used only by `202611150005-backfill-profile-completion-awards`.
 *
 * A migration must mean the same thing forever, so nothing here imports app
 * code: the item codes, the facts query, the bio predicate and the invisible-
 * character pattern are copies of `modules/progression/profile-completion*.ts`
 * and `common/text/invisible-characters.ts`. `profile-completion-backfill.spec.ts`
 * (unit) and `test/profile-completion.e2e-spec.ts` (SQL, on PostgreSQL) fail if
 * the live service drifts from this snapshot; when it does on purpose, leave
 * this file alone — it describes what "already had it at deploy" meant then.
 */

export interface FrozenProfileFacts {
  hasBodyProfile: boolean;
  hasBirthDate: boolean;
  photoCount: number;
  hasBio: boolean;
  hasGender: boolean;
  hasExperienceLevel: boolean;
  interestCount: number;
}

export interface FrozenUserFacts {
  userId: string;
  tenantId: string | null;
  facts: FrozenProfileFacts;
}

const FROZEN_INVISIBLE =
  /[^\P{Cf}‍]|(?<![\p{Extended_Pictographic}\p{Emoji_Modifier}️])‍|‍(?!\p{Extended_Pictographic})|[ᅟᅠㅤﾠ⠀]/gu;

export function frozenStripInvisible(value: string): string {
  return value.replace(FROZEN_INVISIBLE, "");
}

export function frozenHasMeaningfulBio(bio: string | null | undefined): boolean {
  return (frozenStripInvisible(bio ?? "").match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 3;
}

export const FROZEN_PROFILE_ITEMS: readonly { code: string; done: (facts: FrozenProfileFacts) => boolean }[] = [
  { code: "FOTO", done: (facts) => facts.photoCount >= 1 },
  { code: "DATOS", done: (facts) => facts.hasBodyProfile },
  { code: "BIO", done: (facts) => facts.hasBio },
  { code: "FOTOS_3", done: (facts) => facts.photoCount >= 3 },
  { code: "NIVEL", done: (facts) => facts.hasExperienceLevel },
  { code: "INTERESES", done: (facts) => facts.interestCount >= 1 },
  { code: "NACIMIENTO", done: (facts) => facts.hasBirthDate },
  { code: "GENERO", done: (facts) => facts.hasGender },
];

interface FrozenFactsRow {
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

export const BACKFILL_BATCH = 500;
const BEFORE_ANY_UUID = "00000000-0000-0000-0000-000000000000";

/** The next batch of accounts after `after` (keyset on the id), with their facts. */
export async function frozenFactsBatch(
  sequelize: Sequelize,
  after: string,
  userIds?: readonly string[],
  transaction?: Transaction,
): Promise<FrozenUserFacts[]> {
  const rows = await sequelize.query<FrozenFactsRow>(
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
      WHERE u.id > CAST(:after AS uuid) ${userIds ? "AND u.id IN (:userIds)" : ""}
      ORDER BY u.id
      LIMIT ${BACKFILL_BATCH}`,
    { type: QueryTypes.SELECT, replacements: { after, userIds: userIds ? [...userIds] : [] }, transaction },
  );
  return rows.map((row) => ({
    userId: row.user_id,
    tenantId: row.tenant_id,
    facts: {
      hasBodyProfile: Boolean(row.has_body_profile),
      hasBirthDate: Boolean(row.has_birth_date),
      photoCount: Number(row.photo_count),
      hasBio: frozenHasMeaningfulBio(row.bio),
      hasGender: Boolean(row.has_gender),
      hasExperienceLevel: Boolean(row.has_experience_level),
      interestCount: Number(row.interest_count),
    },
  }));
}

/**
 * Records, at 0 points, every profile item each account already satisfies:
 * no retroactive points (`docs/progression/la-senda.md` §5.1). Idempotent
 * (`ON CONFLICT DO NOTHING`). `tenant_id` is the account's own, never null since
 * `202608300001-usuarios-tenant-not-null`. `userIds` narrows the walk; the
 * migration passes none (every account), the e2e passes its own accounts.
 */
export async function grandfatherExistingProfileItems(
  sequelize: Sequelize,
  transaction?: Transaction,
  userIds?: readonly string[],
): Promise<number> {
  if (userIds?.length === 0) return 0;
  let inserted = 0;
  let after = BEFORE_ANY_UUID;
  for (;;) {
    const batch = await frozenFactsBatch(sequelize, after, userIds, transaction);
    if (batch.length === 0) return inserted;
    after = batch[batch.length - 1].userId;
    const rows = batch.flatMap((user) =>
      FROZEN_PROFILE_ITEMS.filter((item) => item.done(user.facts)).map((item) => ({
        userId: user.userId,
        code: item.code,
        tenantId: user.tenantId,
      })),
    );
    if (rows.length === 0) continue;
    const written = await sequelize.query<{ item_code: string }>(
      `INSERT INTO progression.profile_completion_awards (user_id, item_code, points, tenant_id)
       SELECT row."userId", row.code, 0, row."tenantId"
         FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS row("userId" uuid, code text, "tenantId" text)
       ON CONFLICT (user_id, item_code) DO NOTHING
       RETURNING item_code`,
      { type: QueryTypes.SELECT, replacements: { rows: JSON.stringify(rows) }, transaction },
    );
    inserted += written.length;
  }
}
