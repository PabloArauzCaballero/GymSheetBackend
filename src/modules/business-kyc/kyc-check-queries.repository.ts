import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { businessNameSkeleton } from "../business-accounts/handle-rules";
import type { DirectoryEntityType } from "../directory/directory-entity.model";
import { KycCheckQueries } from "./kyc-checks";
import { FingerprintKind } from "./kyc-cipher";

/** Trigram similarity at or above which two commercial names are too close (plan §2.2). */
export const NAME_SIMILARITY_THRESHOLD = 0.8;

/** SQL behind the automatic checks; each is one indexed probe. */
@Injectable()
export class KycCheckQueriesRepository implements KycCheckQueries {
  constructor(private readonly sequelize: Sequelize) {}

  private async exists(sql: string, replacements: Record<string, unknown>, transaction: Transaction): Promise<boolean> {
    const [row] = await this.sequelize.query<{ hit: boolean }>(`SELECT EXISTS (${sql}) AS hit`, {
      type: QueryTypes.SELECT,
      replacements,
      transaction,
    });
    return row?.hit === true;
  }

  async countOtherAccountsWith(kind: FingerprintKind, hmac: string, exceptAccountId: string, transaction: Transaction): Promise<number> {
    const [row] = await this.sequelize.query<{ count: number }>(
      `SELECT count(DISTINCT f.account_id)::int AS count
         FROM business.identity_fingerprints f
         JOIN business.accounts a ON a.user_id = f.account_id
        WHERE f.kind = :kind AND f.hmac = :hmac AND f.revoked_at IS NULL
          AND f.account_id <> :exceptAccountId AND a.status <> 'CLOSED'`,
      { type: QueryTypes.SELECT, replacements: { kind, hmac, exceptAccountId }, transaction },
    );
    return row?.count ?? 0;
  }

  nameLooksTaken(name: string, entityType: DirectoryEntityType, exceptEntityId: string, transaction: Transaction): Promise<boolean> {
    return this.exists(
      `SELECT 1 FROM directory.entities e
        WHERE e.status = 'ACTIVE' AND e.entity_type = :entityType AND e.id <> :exceptEntityId
          AND public.repp_normalize(e.name) OPERATOR(public.%) public.repp_normalize(:name)
          AND public.similarity(public.repp_normalize(e.name), public.repp_normalize(:name)) >= :threshold
       UNION ALL
       SELECT 1 FROM directory.handles h WHERE h.status = 'RESERVED' AND h.skeleton = :skeleton`,
      { name, entityType, exceptEntityId, threshold: NAME_SIMILARITY_THRESHOLD, skeleton: businessNameSkeleton(name) },
      transaction,
    );
  }

  isBlocked(fingerprints: readonly { kind: FingerprintKind; hmac: string }[], transaction: Transaction): Promise<boolean> {
    if (fingerprints.length === 0) return Promise.resolve(false);
    const pairs = fingerprints.map((_, index) => `(b.kind = :kind${index} AND b.hmac = :hmac${index})`).join(" OR ");
    const replacements = Object.fromEntries(
      fingerprints.flatMap((entry, index) => [
        [`kind${index}`, entry.kind],
        [`hmac${index}`, entry.hmac],
      ]),
    );
    return this.exists(
      `SELECT 1 FROM business.blocklist b
        WHERE b.removed_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > now()) AND (${pairs})`,
      replacements,
      transaction,
    );
  }

  hasClosedAccountSanction(emailHmac: string, transaction: Transaction): Promise<boolean> {
    return this.exists(
      `SELECT 1 FROM moderation.closed_account_sanctions WHERE email_hmac = :emailHmac AND expires_at > now()`,
      { emailHmac },
      transaction,
    );
  }

  /** Whole-word match of a NAME/BOTH term in the normalized texts. */
  containsBannedTerm(texts: readonly string[], transaction: Transaction): Promise<boolean> {
    return this.exists(
      `SELECT 1 FROM business.banned_terms t
        WHERE t.scope IN ('NAME', 'BOTH')
          AND (' ' || public.repp_normalize(:text) || ' ') LIKE ('% ' || public.repp_normalize(t.term) || ' %')`,
      { text: texts.join(" ") },
      transaction,
    );
  }
}
