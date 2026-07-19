import { QueryTypes, Transaction } from 'sequelize';
import { QueryInterface } from 'sequelize';

/** Executes ordered DDL statements inside the migration transaction. */
export async function executeSqlStatements(
  queryInterface: QueryInterface,
  transaction: Transaction,
  statements: readonly string[],
): Promise<void> {
  for (const statement of statements) {
    await queryInterface.sequelize.query(statement, {
      type: QueryTypes.RAW,
      transaction,
    });
  }
}
