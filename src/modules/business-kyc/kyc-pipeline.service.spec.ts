import type { Transaction } from "sequelize";
import type { Sequelize } from "sequelize-typescript";
import { KycCheck, KycCheckContext, KycCheckQueries } from "./kyc-checks";
import { KycPipelineService, decidePipeline } from "./kyc-pipeline.service";

/** Runs the savepoint callback right away, as Sequelize does inside an open transaction. */
function fakeSequelize() {
  const statements: string[] = [];
  const sequelize = {
    query: jest.fn((sql: string) => {
      statements.push(sql);
      return Promise.resolve([]);
    }),
    transaction: jest.fn((_options: unknown, work: (savepoint: Transaction) => Promise<unknown>) => work({} as Transaction)),
  };
  return { sequelize: sequelize as unknown as Sequelize, statements };
}

const context = {} as KycCheckContext;
const queries = {} as KycCheckQueries;
const pass = (code: KycCheck["code"]): KycCheck => ({ code, run: () => Promise.resolve({ outcome: "PASS" }) });

describe("KycPipelineService", () => {
  it("bounds every query with a statement timeout and restores it afterwards", async () => {
    const { sequelize, statements } = fakeSequelize();
    const pipeline = new KycPipelineService(sequelize, queries, () => new Date(0), { budgetMs: 2000, statementTimeoutMs: 500, checks: [pass("BLOCKLIST")] });
    const records = await pipeline.run(context, {} as Transaction);
    expect(records).toEqual([{ code: "BLOCKLIST", outcome: "PASS", detail: {}, durationMs: 0 }]);
    expect(statements).toEqual(["SET LOCAL statement_timeout = '500ms'", "SET LOCAL statement_timeout = DEFAULT"]);
    expect(decidePipeline(records, false)).toBe("AUTO_APPROVE");
  });

  it("a slow check past the budget is ERROR (TIMEOUT) and the submission goes to review", async () => {
    const { sequelize } = fakeSequelize();
    const slow: KycCheck = {
      code: "DUPLICATE_NIT",
      run: () => new Promise((resolve) => setTimeout(() => resolve({ outcome: "PASS" }), 200)),
    };
    const pipeline = new KycPipelineService(sequelize, queries, () => new Date(), { budgetMs: 30, statementTimeoutMs: 500, checks: [slow] });
    const records = await pipeline.run(context, {} as Transaction);
    expect(records[0]).toMatchObject({ code: "DUPLICATE_NIT", outcome: "ERROR", detail: { reason: "TIMEOUT" } });
    expect(decidePipeline(records, false)).toBe("ROUTE_TO_REVIEW");
  });

  it("checks reached after the budget is spent are ERROR without running (fake clock)", async () => {
    const { sequelize } = fakeSequelize();
    let now = 0;
    const clock = () => new Date(now);
    const expensive: KycCheck = {
      code: "PHONE_VERIFIED",
      run: () => {
        now += 2500; // The clock jumps past the 2000 ms budget during this check.
        return Promise.resolve({ outcome: "PASS" });
      },
    };
    const never = jest.fn();
    const pipeline = new KycPipelineService(sequelize, queries, clock, {
      budgetMs: 2000,
      statementTimeoutMs: 500,
      checks: [expensive, { code: "BLOCKLIST", run: never }],
    });
    const records = await pipeline.run(context, {} as Transaction);
    expect(records).toEqual([
      { code: "PHONE_VERIFIED", outcome: "PASS", detail: {}, durationMs: 2500 },
      { code: "BLOCKLIST", outcome: "ERROR", detail: { reason: "BUDGET_EXCEEDED" }, durationMs: 0 },
    ]);
    expect(never).not.toHaveBeenCalled();
    expect(decidePipeline(records, false)).toBe("ROUTE_TO_REVIEW");
  });

  it("a check that throws is ERROR (FAILED), never a rejection, and the others still run", async () => {
    const { sequelize } = fakeSequelize();
    const failing: KycCheck = { code: "NAME_SIMILARITY", run: () => Promise.reject(new Error("canceling statement due to statement timeout")) };
    const pipeline = new KycPipelineService(sequelize, queries, () => new Date(0), {
      budgetMs: 2000,
      statementTimeoutMs: 500,
      checks: [failing, pass("BANNED_TERMS")],
    });
    const records = await pipeline.run(context, {} as Transaction);
    expect(records.map((record) => [record.code, record.outcome])).toEqual([["NAME_SIMILARITY", "ERROR"], ["BANNED_TERMS", "PASS"]]);
    expect(records[0].detail).toEqual({ reason: "FAILED" });
  });

  it("decides: every PASS approves; any FAIL/WARN/ERROR or a material change goes to review", () => {
    const record = (outcome: "PASS" | "FAIL" | "WARN" | "ERROR") => ({ code: "BLOCKLIST" as const, outcome, detail: {}, durationMs: 1 });
    expect(decidePipeline([record("PASS"), record("PASS")], false)).toBe("AUTO_APPROVE");
    expect(decidePipeline([record("PASS"), record("PASS")], true)).toBe("ROUTE_TO_REVIEW");
    for (const outcome of ["FAIL", "WARN", "ERROR"] as const) expect(decidePipeline([record("PASS"), record(outcome)], false)).toBe("ROUTE_TO_REVIEW");
  });
});
