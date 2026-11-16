import { Inject, Injectable } from "@nestjs/common";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { env } from "../../config/env";
import { KYC_CHECKS, KycCheck, KycCheckContext, KycCheckQueries, KycCheckResult } from "./kyc-checks";
import { KycCheckCode, KycCheckOutcome } from "./kyc.catalog";

export const KYC_CHECK_QUERIES = Symbol("KYC_CHECK_QUERIES");
export const KYC_CLOCK = Symbol("KYC_CLOCK");
export type KycClock = () => Date;

export type KycPipelineConfig = { budgetMs: number; statementTimeoutMs: number; checks: readonly KycCheck[] };
export const KYC_PIPELINE_CONFIG = Symbol("KYC_PIPELINE_CONFIG");
export const defaultKycPipelineConfig = (): KycPipelineConfig => ({
  budgetMs: env.KYC_PIPELINE_BUDGET_MS,
  statementTimeoutMs: env.KYC_CHECK_STATEMENT_TIMEOUT_MS,
  checks: KYC_CHECKS,
});

export type CheckRecord = { code: KycCheckCode; outcome: KycCheckOutcome; detail: Record<string, unknown>; durationMs: number };
export type PipelineDecision = "AUTO_APPROVE" | "ROUTE_TO_REVIEW";

class CheckTimeout extends Error {}

/**
 * Runs the automatic checks of one submission inside the submit transaction
 * (plan §2.6). Every query is bounded by `statement_timeout` and the whole run
 * by `KYC_PIPELINE_BUDGET_MS`; each check runs in its own savepoint, so a
 * check that times out or throws is recorded as ERROR without poisoning the
 * transaction, and a check reached after the budget is spent is ERROR without
 * running. ERROR never rejects: it routes to REPP review.
 */
@Injectable()
export class KycPipelineService {
  constructor(
    private readonly sequelize: Sequelize,
    @Inject(KYC_CHECK_QUERIES) private readonly queries: KycCheckQueries,
    @Inject(KYC_CLOCK) private readonly clock: KycClock,
    @Inject(KYC_PIPELINE_CONFIG) private readonly config: KycPipelineConfig,
  ) {}

  async run(context: KycCheckContext, transaction: Transaction): Promise<CheckRecord[]> {
    const deadline = this.clock().getTime() + this.config.budgetMs;
    await this.setStatementTimeout(transaction, `${this.config.statementTimeoutMs}ms`);
    const records: CheckRecord[] = [];
    try {
      for (const check of this.config.checks) {
        const remaining = deadline - this.clock().getTime();
        if (remaining <= 0) {
          records.push({ code: check.code, outcome: "ERROR", detail: { reason: "BUDGET_EXCEEDED" }, durationMs: 0 });
          continue;
        }
        records.push(await this.runOne(check, context, transaction, remaining));
      }
    } finally {
      await this.setStatementTimeout(transaction, "DEFAULT");
    }
    return records;
  }

  private async runOne(check: KycCheck, context: KycCheckContext, transaction: Transaction, remainingMs: number): Promise<CheckRecord> {
    const started = this.clock().getTime();
    const pending = this.sequelize.transaction({ transaction }, (savepoint) => check.run(context, this.queries, savepoint));
    let result: KycCheckResult;
    try {
      result = await withTimeout(pending, remainingMs);
    } catch (error: unknown) {
      // The savepoint must settle before the next query runs on this connection.
      await pending.catch(() => undefined);
      result = { outcome: "ERROR", detail: { reason: error instanceof CheckTimeout ? "TIMEOUT" : "FAILED" } };
    }
    return { code: check.code, outcome: result.outcome, detail: result.detail ?? {}, durationMs: Math.max(0, this.clock().getTime() - started) };
  }

  private async setStatementTimeout(transaction: Transaction, value: string): Promise<void> {
    const literal = value === "DEFAULT" ? "DEFAULT" : `'${value.replace(/[^0-9a-z]/gu, "")}'`;
    await this.sequelize.query(`SET LOCAL statement_timeout = ${literal}`, { transaction });
  }
}

/** All PASS approves on its own; anything else, or a material change, is a human decision. */
export function decidePipeline(records: readonly CheckRecord[], materialChange: boolean): PipelineDecision {
  if (materialChange) return "ROUTE_TO_REVIEW";
  return records.every((record) => record.outcome === "PASS") ? "AUTO_APPROVE" : "ROUTE_TO_REVIEW";
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CheckTimeout()), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
