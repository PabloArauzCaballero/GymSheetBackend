import { QueryInterface, Transaction } from "sequelize";
import { profileGoalSportPerformanceMigration } from "./202611150003-profile-goal-sport-performance";
import { validateProfileGoalCheckMigration } from "./202611150004-validate-profile-goal-check";
import { DatabaseMigration } from "./migration.types";

async function statementsOf(migration: DatabaseMigration): Promise<string[]> {
  const statements: string[] = [];
  const queryInterface = { sequelize: { query: jest.fn(async (sql: string) => statements.push(sql)) } };
  await migration.up(queryInterface as unknown as QueryInterface, {} as Transaction);
  return statements;
}

/** The goal CHECK must not scan perfiles_antropometricos under ACCESS EXCLUSIVE. */
describe("profile goal CHECK migrations", () => {
  it("adds the constraint NOT VALID and does not validate it in the same transaction", async () => {
    const statements = await statementsOf(profileGoalSportPerformanceMigration);
    const add = statements.find((sql) => /ADD CONSTRAINT ck_perfiles_objetivo/.test(sql));
    expect(add).toMatch(/'RENDIMIENTO_DEPORTIVO'.*\)\) NOT VALID$/);
    expect(statements.some((sql) => /VALIDATE CONSTRAINT/.test(sql))).toBe(false);
  });

  it("validates it in a later migration of its own", async () => {
    expect(await statementsOf(validateProfileGoalCheckMigration)).toEqual([
      "ALTER TABLE public.perfiles_antropometricos VALIDATE CONSTRAINT ck_perfiles_objetivo",
    ]);
  });
});
