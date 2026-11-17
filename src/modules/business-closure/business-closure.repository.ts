import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { BusinessClosureEffect, ClosureStep } from "../account/account-closure.steps";
import { ACCOUNT_ENTITY, BUSINESS_CLOSURE_STEPS, RECEIPT_WAITING } from "./business-closure.catalog";

export type ClosingBusiness = {
  userId: string;
  entityId: string;
  status: string;
  name: string;
  logoUrl: string | null;
  coverUrl: string | null;
  gallery: string[] | null;
};

export type EndedAffiliation = { id: string; kind: "SOCIO" | "ENTRENADOR"; recipientUserId: string | null; closingIsGym: boolean };
export type CancelledPeriod = { id: string; userId: string; planName: string; fromStatus: "ACTIVE" | "SUSPENDED" };

/** The step of the catalogue that drives an effect: the preview counts what the closure then changes. */
export function effectStep(effect: BusinessClosureEffect): ClosureStep {
  const step = BUSINESS_CLOSURE_STEPS.find((candidate) => candidate.effect === effect);
  if (!step) throw new Error(`Business closure step missing: ${effect}`);
  return step;
}

/** SQL of the business closure that the generic catalogue cannot express (locks, row-by-row effects). */
@Injectable()
export class BusinessClosureRepository {
  constructor(private readonly sequelize: Sequelize) {}

  private select<T extends object>(sql: string, replacements: Record<string, unknown>, transaction?: Transaction): Promise<T[]> {
    return this.sequelize.query<T>(sql, { type: QueryTypes.SELECT, replacements, transaction });
  }

  /** The account and its listing, row-locked: no profile edit, order or decision of the business interleaves. */
  async lockAccount(userId: string, transaction: Transaction): Promise<ClosingBusiness | null> {
    const [row] = await this.select<ClosingBusiness>(
      `SELECT a.user_id AS "userId", a.entity_id AS "entityId", a.status, e.name, e.logo_url AS "logoUrl",
              e.cover_url AS "coverUrl", e.gallery
         FROM business.accounts a JOIN directory.entities e ON e.id = a.entity_id
        WHERE a.user_id = :userId
        FOR UPDATE OF a, e`,
      { userId },
      transaction,
    );
    return row ?? null;
  }

  /**
   * Every listing of the business, row-locked in id order: an order being
   * created locks its listing first, so it either commits before the closure
   * reads the orders or finds its listing archived.
   */
  lockListings(entityId: string, transaction: Transaction): Promise<{ id: string; mediaUrls: string[] | null }[]> {
    return this.select(
      `SELECT id, media_urls AS "mediaUrls" FROM directory.entity_plans WHERE entity_id = :entityId ORDER BY id FOR UPDATE`,
      { entityId },
      transaction,
    );
  }

  /** Receipts the business has not decided; the open orders are row-locked first so none moves meanwhile. */
  async lockOrdersAndCountWaitingReceipts(userId: string, transaction?: Transaction): Promise<number> {
    if (transaction) {
      await this.select(
        `SELECT t.id FROM directory.payment_orders t
          WHERE t.entity_id = ${ACCOUNT_ENTITY} AND t.status IN ('PENDING_PAYMENT', 'PENDING_VERIFICATION', 'REJECTED')
          ORDER BY t.id FOR UPDATE`,
        { userId },
        transaction,
      );
    }
    const [row] = await this.select<{ count: number }>(
      `SELECT count(*)::int AS count FROM directory.payment_orders t WHERE t.entity_id = ${ACCOUNT_ENTITY} AND ${RECEIPT_WAITING}`,
      { userId },
      transaction,
    );
    return row?.count ?? 0;
  }

  /** Ids the effect's catalogue predicate selects, in id order. */
  async effectIds(effect: BusinessClosureEffect, userId: string, transaction: Transaction): Promise<string[]> {
    const step = effectStep(effect);
    const rows = await this.select<{ id: string }>(`SELECT t.id FROM ${step.table} t WHERE ${step.where} ORDER BY t.id`, { userId }, transaction);
    return rows.map((row) => row.id);
  }

  /** NIT and CI fingerprints of every KYC version of the account (ADR-0021), for the closed-account sanction. */
  async identityHmacs(userId: string, transaction: Transaction): Promise<{ nit: string[]; ci: string[] }> {
    const rows = await this.select<{ kind: "NIT" | "CI"; hmac: string }>(
      `SELECT DISTINCT kind, hmac FROM business.identity_fingerprints WHERE account_id = :userId AND kind IN ('NIT', 'CI') ORDER BY kind, hmac`,
      { userId },
      transaction,
    );
    return { nit: rows.filter((row) => row.kind === "NIT").map((row) => row.hmac), ci: rows.filter((row) => row.kind === "CI").map((row) => row.hmac) };
  }

  /**
   * Live affiliations of the closing gym (members and coaches) or coach
   * (its gym links) end with `BUSINESS_CLOSED`; a pending request is
   * cancelled. The table's trigger appends each history row; the CI digits go
   * (`ck_affiliations_ci_closed`). Returns who to tell: the person or coach of
   * a closing gym, or the gym of a closing coach.
   */
  endAffiliations(userId: string, transaction: Transaction): Promise<EndedAffiliation[]> {
    const step = effectStep("END_AFFILIATIONS");
    return this.select<EndedAffiliation>(
      `UPDATE directory.affiliations t
          SET status = CASE t.status WHEN 'REQUESTED' THEN 'CANCELLED' ELSE 'ENDED' END,
              reason_code = 'BUSINESS_CLOSED', reason_note = NULL, changed_by_user_id = NULL,
              closed_at = now(), ci_last3 = NULL, updated_at = now()
        WHERE ${step.where}
       RETURNING t.id, t.kind, (t.gym_entity_id = ${ACCOUNT_ENTITY}) AS "closingIsGym",
                 CASE WHEN t.gym_entity_id = ${ACCOUNT_ENTITY}
                      THEN COALESCE(t.user_id, (SELECT b.user_id FROM business.accounts b WHERE b.entity_id = t.coach_entity_id))
                      ELSE (SELECT b.user_id FROM business.accounts b WHERE b.entity_id = t.gym_entity_id) END AS "recipientUserId"`,
      { userId },
      transaction,
    );
  }

  /** Periods still running or not started: CANCELLED (the history and the event are written by the caller). */
  cancelPeriods(userId: string, transaction: Transaction): Promise<CancelledPeriod[]> {
    const step = effectStep("CANCEL_PERIODS");
    return this.select<CancelledPeriod>(
      `WITH target AS (SELECT t.id, t.status FROM ${step.table} t WHERE ${step.where} ORDER BY t.id FOR UPDATE)
       UPDATE membership.memberships m SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
         FROM target WHERE m.id = target.id
       RETURNING m.id, m.user_id AS "userId", COALESCE(m.plan_name, 'tu suscripción') AS "planName", target.status AS "fromStatus"`,
      { userId },
      transaction,
    );
  }

  async recordPeriodHistory(input: { id: string; membershipId: string; fromStatus: string; domainEventId: string }, transaction: Transaction): Promise<void> {
    await this.sequelize.query(
      `INSERT INTO membership.status_history (id, membership_id, from_status, to_status, reason, actor_user_id, domain_event_id)
       VALUES (:id, :membershipId, :fromStatus, 'CANCELLED', 'BUSINESS_CLOSED', NULL, :domainEventId)`,
      { replacements: input, transaction },
    );
  }
}
