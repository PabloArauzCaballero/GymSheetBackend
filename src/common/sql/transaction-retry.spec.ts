import { Sequelize } from "sequelize-typescript";
import { isRetryableTransactionError, transactionWithRetry } from "./transaction-retry";

const deadlock = Object.assign(new Error("deadlock detected"), { parent: { code: "40P01" } });

function fakeSequelize(failures: Error[]) {
  const transaction = jest.fn(async (work: (t: unknown) => Promise<unknown>) => {
    const failure = failures.shift();
    if (failure) throw failure;
    return work({});
  });
  return { sequelize: { transaction } as unknown as Sequelize, transaction };
}

describe("transactionWithRetry", () => {
  it("runs again after a deadlock and returns the result", async () => {
    const { sequelize, transaction } = fakeSequelize([deadlock]);
    await expect(transactionWithRetry(sequelize, async () => "ok")).resolves.toBe("ok");
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("gives up after the last attempt", async () => {
    const { sequelize, transaction } = fakeSequelize([deadlock, deadlock, deadlock]);
    await expect(transactionWithRetry(sequelize, async () => "ok")).rejects.toBe(deadlock);
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it("does not retry other errors", async () => {
    const other = Object.assign(new Error("unique"), { parent: { code: "23505" } });
    const { sequelize, transaction } = fakeSequelize([other]);
    await expect(transactionWithRetry(sequelize, async () => "ok")).rejects.toBe(other);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(isRetryableTransactionError({ original: { code: "40001" } })).toBe(true);
    expect(isRetryableTransactionError(null)).toBe(false);
  });
});
