import { Injectable } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import type { DirectoryEntityType } from "../directory/directory-entity.model";

export type QueueRow = {
  submissionId: string;
  accountId: string;
  entityId: string;
  entityType: string;
  tradeName: string | null;
  handle: string | null;
  version: number;
  purpose: string;
  status: string;
  submittedAt: Date;
  dueAt: Date;
  claimedByUserId: string | null;
  claimedAt: Date | null;
  failedChecks: string[];
};

export type QueueFilter = {
  queue: "REVIEW" | "POST_REVIEW";
  entityType?: DirectoryEntityType;
  overdue?: boolean;
  after: { dueAt: Date; id: string } | null;
  limit: number;
};

export type AccountListRow = {
  accountId: string;
  email: string;
  entityId: string;
  entityType: string;
  name: string;
  handle: string | null;
  status: string;
  kycStatus: string;
  entityStatus: string;
  isVerified: boolean;
  createdAt: Date;
};

/** REPP console reads (`admin/business/*`); every list is keyset-paginated over an index. */
@Injectable()
export class KycReviewRepository {
  constructor(private readonly sequelize: Sequelize) {}

  listQueue(filter: QueueFilter, now: Date): Promise<QueueRow[]> {
    const due = filter.queue === "REVIEW" ? "s.review_due_at" : "s.post_review_due_at";
    const status = filter.queue === "REVIEW" ? "IN_REVIEW" : "AUTO_APPROVED";
    return this.sequelize.query<QueueRow>(
      `SELECT s.id AS "submissionId", s.account_id AS "accountId", a.entity_id AS "entityId", a.entity_type AS "entityType",
              s.trade_name AS "tradeName",
              (SELECT h.handle FROM directory.handles h WHERE h.owner_entity_id = a.entity_id AND h.status IN ('PENDING', 'ACTIVE')) AS handle,
              s.version, s.purpose, s.status, s.submitted_at AS "submittedAt", ${due} AS "dueAt",
              s.claimed_by_user_id AS "claimedByUserId", s.claimed_at AS "claimedAt",
              COALESCE((SELECT array_agg(DISTINCT c.code ORDER BY c.code) FROM business.kyc_checks c
                         WHERE c.submission_id = s.id AND c.outcome <> 'PASS'), '{}') AS "failedChecks"
         FROM business.kyc_submissions s JOIN business.accounts a ON a.user_id = s.account_id
        WHERE s.status = :status
          ${filter.entityType ? "AND a.entity_type = :entityType" : ""}
          ${filter.overdue === true ? `AND ${due} <= :now` : filter.overdue === false ? `AND ${due} > :now` : ""}
          ${filter.after ? `AND (${due}, s.id) > (:afterDueAt, :afterId)` : ""}
        ORDER BY ${due}, s.id
        LIMIT :limit`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          status,
          entityType: filter.entityType ?? null,
          now,
          afterDueAt: filter.after?.dueAt ?? null,
          afterId: filter.after?.id ?? null,
          limit: filter.limit,
        },
      },
    );
  }

  /** Claim if nobody holds it, the actor holds it, or the other claim went stale. Returns the holder after the attempt. */
  async claim(submissionId: string, actorId: string, staleBefore: Date, transaction: Transaction): Promise<string | null> {
    const [row] = await this.sequelize.query<{ holder: string | null }>(
      `UPDATE business.kyc_submissions SET
              claimed_by_user_id = CASE WHEN claimed_by_user_id IS NULL OR claimed_by_user_id = :actorId OR claimed_at < :staleBefore
                                        THEN CAST(:actorId AS uuid) ELSE claimed_by_user_id END,
              claimed_at = CASE WHEN claimed_by_user_id IS NULL OR claimed_by_user_id = :actorId OR claimed_at < :staleBefore
                                THEN now() ELSE claimed_at END
        WHERE id = :submissionId
        RETURNING claimed_by_user_id AS holder`,
      { type: QueryTypes.SELECT, replacements: { submissionId, actorId, staleBefore }, transaction },
    );
    return row?.holder ?? null;
  }

  async release(submissionId: string, transaction: Transaction): Promise<void> {
    await this.sequelize.query(
      `UPDATE business.kyc_submissions SET claimed_by_user_id = NULL, claimed_at = NULL WHERE id = :submissionId`,
      { replacements: { submissionId }, transaction },
    );
  }

  async listAccounts(
    filter: { search?: string; status?: string; entityType?: string; after: { createdAt: Date; id: string } | null; limit: number },
  ): Promise<AccountListRow[]> {
    return this.sequelize.query<AccountListRow>(
      `SELECT a.user_id AS "accountId", u.email, a.entity_id AS "entityId", a.entity_type AS "entityType", e.name,
              (SELECT h.handle FROM directory.handles h WHERE h.owner_entity_id = a.entity_id AND h.status IN ('PENDING', 'ACTIVE')) AS handle,
              a.status, a.kyc_status AS "kycStatus", e.status AS "entityStatus", e.is_verified AS "isVerified", a.created_at AS "createdAt"
         FROM business.accounts a
         JOIN public.usuarios u ON u.id = a.user_id
         JOIN directory.entities e ON e.id = a.entity_id
        WHERE TRUE
          ${filter.status ? "AND a.status = :status" : ""}
          ${filter.entityType ? "AND a.entity_type = :entityType" : ""}
          ${filter.search ? "AND (public.repp_normalize(e.name) LIKE '%' || public.repp_normalize(:search) || '%' OR lower(u.email) = lower(:search))" : ""}
          ${filter.after ? "AND (a.created_at, a.user_id) < (:afterCreatedAt, :afterId)" : ""}
        ORDER BY a.created_at DESC, a.user_id DESC
        LIMIT :limit`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          status: filter.status ?? null,
          entityType: filter.entityType ?? null,
          search: filter.search ?? null,
          afterCreatedAt: filter.after?.createdAt ?? null,
          afterId: filter.after?.id ?? null,
          limit: filter.limit,
        },
      },
    );
  }
}
