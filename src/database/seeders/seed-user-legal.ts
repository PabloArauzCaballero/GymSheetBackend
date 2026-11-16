import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { UserGender } from "../../common/enums/domain.enums";
import { LEGAL_DOCUMENTS, currentLegalDocuments } from "../../modules/legal/legal-documents";

/** Adult birth date and sex given to seeded accounts that do not have one yet. */
export const SEED_USER_DEMOGRAPHICS = {
  birthDate: "1990-01-15",
  gender: UserGender.MALE,
} as const;

/**
 * Seeded accounts accept every current legal document, so a development login
 * is not blocked by the legal-acceptance guard. Idempotent: re-running the
 * seed keeps the original acceptance rows.
 */
export async function seedLegalAcceptances(
  sequelize: Sequelize,
  userId: string,
  transaction: Transaction,
): Promise<void> {
  const documents = currentLegalDocuments();
  await sequelize.query(
    `INSERT INTO auth.terms_acceptances (user_id, document, version, channel)
     SELECT :userId, entry.document, entry.version, 'UNKNOWN'
       FROM unnest(ARRAY[:documents]::varchar[], ARRAY[:versions]::varchar[]) AS entry(document, version)
     ON CONFLICT (user_id, document, version) DO NOTHING`,
    {
      type: QueryTypes.INSERT,
      transaction,
      replacements: {
        userId,
        documents: documents.map((entry) => entry.document),
        versions: documents.map((entry) => entry.version),
      },
    },
  );
  await sequelize.query(
    `UPDATE public.usuarios
        SET accepted_terms_at = COALESCE(accepted_terms_at, now()), terms_version = :version
      WHERE id = :userId`,
    { type: QueryTypes.UPDATE, transaction, replacements: { userId, version: LEGAL_DOCUMENTS.TERMS } },
  );
}
