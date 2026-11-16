import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";

/** PostgreSQL deadlock_detected and serialization_failure: the transaction was rolled back and can run again. */
const RETRYABLE_SQLSTATES = new Set(["40P01", "40001"]);

export function isRetryableTransactionError(error: unknown): boolean {
  const cause = error as { parent?: { code?: string }; original?: { code?: string } } | null;
  const code = cause?.parent?.code ?? cause?.original?.code;
  return code !== undefined && RETRYABLE_SQLSTATES.has(code);
}

/**
 * Runs `work` in a transaction and runs it again when PostgreSQL aborted it as
 * a deadlock victim or a serialization failure. Consistent lock order is the
 * real fix; this keeps a rare, unforeseen cycle from reaching the user as a 500.
 * `work` must only have effects inside the transaction (it can run more than once).
 */
export async function transactionWithRetry<T>(
  sequelize: Sequelize,
  work: (transaction: Transaction) => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await sequelize.transaction(work);
    } catch (error) {
      if (attempt >= attempts || !isRetryableTransactionError(error)) throw error;
    }
  }
}
