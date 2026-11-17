import { Injectable } from "@nestjs/common";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";

type QueueSnapshot = { queue: "REVIEW" | "POST_REVIEW"; size: number; overdue: number; ageP95Seconds: number };

/**
 * Prometheus block of the REPP KYC queues (plan §2.7), read live on each
 * scrape of `/health/metrics`: size, SLA breaches and p95 age per queue, and
 * the automatic approval rate of the last 7 days. Both queues are always
 * rendered, zeros included, so an alert needs no `absent()`.
 */
@Injectable()
export class KycMetricsService {
  constructor(private readonly sequelize: Sequelize) {}

  async renderPrometheus(): Promise<string> {
    const queues = await this.sequelize.query<QueueSnapshot>(
      `WITH waiting AS (
         SELECT CASE status WHEN 'IN_REVIEW' THEN 'REVIEW' ELSE 'POST_REVIEW' END AS queue,
                CASE status WHEN 'IN_REVIEW' THEN review_due_at ELSE post_review_due_at END AS due,
                extract(epoch FROM now() - submitted_at) AS age
           FROM business.kyc_submissions WHERE status IN ('IN_REVIEW', 'AUTO_APPROVED'))
       SELECT queue, count(*)::int AS size, count(*) FILTER (WHERE due <= now())::int AS overdue,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY age)::float AS "ageP95Seconds"
         FROM waiting GROUP BY queue`,
      { type: QueryTypes.SELECT },
    );
    const [rate] = await this.sequelize.query<{ total: number; automatic: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE decision = 'AUTO_APPROVE')::int AS automatic
         FROM business.kyc_decisions WHERE decision IN ('AUTO_APPROVE', 'ROUTE_TO_REVIEW') AND created_at > now() - interval '7 days'`,
      { type: QueryTypes.SELECT },
    );
    const byQueue = new Map(queues.map((row) => [row.queue, row]));
    const lines = [
      "# HELP gym_sheet_kyc_queue_size KYC submissions waiting in each REPP queue.",
      "# TYPE gym_sheet_kyc_queue_size gauge",
      ...(["POST_REVIEW", "REVIEW"] as const).map((queue) => `gym_sheet_kyc_queue_size{queue="${queue}"} ${byQueue.get(queue)?.size ?? 0}`),
      "# HELP gym_sheet_kyc_queue_overdue KYC submissions past their SLA in each REPP queue.",
      "# TYPE gym_sheet_kyc_queue_overdue gauge",
      ...(["POST_REVIEW", "REVIEW"] as const).map((queue) => `gym_sheet_kyc_queue_overdue{queue="${queue}"} ${byQueue.get(queue)?.overdue ?? 0}`),
      "# HELP gym_sheet_kyc_queue_age_p95_seconds p95 age (since submit) of the submissions waiting in each REPP queue.",
      "# TYPE gym_sheet_kyc_queue_age_p95_seconds gauge",
      ...(["POST_REVIEW", "REVIEW"] as const).map(
        (queue) => `gym_sheet_kyc_queue_age_p95_seconds{queue="${queue}"} ${Number(byQueue.get(queue)?.ageP95Seconds ?? 0).toFixed(3)}`,
      ),
      "# HELP gym_sheet_kyc_auto_approval_ratio Share of submits of the last 7 days approved automatically (0 without submits).",
      "# TYPE gym_sheet_kyc_auto_approval_ratio gauge",
      `gym_sheet_kyc_auto_approval_ratio ${rate && rate.total > 0 ? (rate.automatic / rate.total).toFixed(4) : "0"}`,
    ];
    return `${lines.join("\n")}\n`;
  }
}
