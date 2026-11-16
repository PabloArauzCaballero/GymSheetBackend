import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";

/** A card handed to a viewer, optionally tagged with the ranking that placed it. */
export interface IssuedImpression {
  id: string;
  targetId: string;
  featureCodes: string[];
  rankingVersion?: string | null;
  rankingPosition?: number | null;
}

/** One INSERT for the whole page (it used to be one round trip per card). */
export async function insertDiscoveryImpressions(
  sequelize: Sequelize,
  viewerId: string,
  impressions: readonly IssuedImpression[],
  transaction?: Transaction,
): Promise<void> {
  if (!impressions.length) return;
  await sequelize.query(
    `INSERT INTO social.discovery_impressions
       (id, viewer_id, target_id, feature_codes, ranking_version, ranking_position)
     SELECT item.id, :viewerId, item.target_id,
            ARRAY(SELECT jsonb_array_elements_text(item.feature_codes)),
            item.ranking_version, item.ranking_position
       FROM jsonb_to_recordset(CAST(:items AS jsonb)) AS item(
              id uuid, target_id uuid, feature_codes jsonb,
              ranking_version varchar(32), ranking_position smallint)
     ON CONFLICT (id) DO NOTHING`,
    {
      replacements: {
        viewerId,
        items: JSON.stringify(
          impressions.map((impression) => ({
            id: impression.id,
            target_id: impression.targetId,
            feature_codes: impression.featureCodes,
            ranking_version: impression.rankingVersion ?? null,
            ranking_position: impression.rankingPosition ?? null,
          })),
        ),
      },
      transaction,
    },
  );
}

export async function findOpenDiscoveryImpression(
  sequelize: Sequelize,
  viewerId: string,
  impressionId: string,
  transaction?: Transaction,
): Promise<{ targetId: string } | null> {
  const rows = await sequelize.query<{ target_id: string }>(
    `SELECT target_id FROM social.discovery_impressions
      WHERE id = :impressionId AND viewer_id = :viewerId
        AND issued_at >= NOW() - INTERVAL '24 hours'
        AND retracted_at IS NULL AND action IS NULL`,
    { type: QueryTypes.SELECT, replacements: { viewerId, impressionId }, transaction },
  );
  return rows[0] ? { targetId: rows[0].target_id } : null;
}

/** Display acknowledgement (`POST /me/discovery/impressions`). */
export async function markDiscoveryImpressionObserved(
  sequelize: Sequelize,
  viewerId: string,
  impressionId: string,
  transaction: Transaction,
): Promise<boolean> {
  const rows = await sequelize.query<{ id: string }>(
    `UPDATE social.discovery_impressions
        SET observed_at = COALESCE(observed_at, NOW())
      WHERE id = :impressionId AND viewer_id = :viewerId
        AND issued_at >= NOW() - INTERVAL '24 hours'
        AND retracted_at IS NULL AND action IS NULL
      RETURNING id`,
    { type: QueryTypes.SELECT, replacements: { viewerId, impressionId }, transaction },
  );
  return rows.length === 1;
}

/**
 * Binds a swipe to its impression. The display acknowledgement is no longer a
 * precondition (F5.09): a card that is being decided was displayed, so a
 * missing acknowledgement is recorded here instead of rejecting the swipe. A
 * reused, expired, retracted or foreign impression still returns `null`.
 */
export async function consumeDiscoveryImpressionRow(
  sequelize: Sequelize,
  input: { viewerId: string; targetId: string; impressionId: string; action: "LIKE" | "PASS" },
  transaction: Transaction,
): Promise<string[] | null> {
  const rows = await sequelize.query<{ feature_codes: string[] }>(
    `UPDATE social.discovery_impressions
        SET action = :action, acted_at = NOW(), observed_at = COALESCE(observed_at, NOW())
      WHERE id = :impressionId AND viewer_id = :viewerId AND target_id = :targetId
        AND issued_at >= NOW() - INTERVAL '24 hours'
        AND retracted_at IS NULL AND action IS NULL
      RETURNING feature_codes`,
    { type: QueryTypes.SELECT, replacements: input, transaction },
  );
  return rows[0]?.feature_codes ?? null;
}
