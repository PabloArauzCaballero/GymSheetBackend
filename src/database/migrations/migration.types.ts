import { QueryInterface, Transaction } from 'sequelize';

/** Versioned database change executed by the internal migration runner. */
export type DatabaseMigration = {
  id: string;
  description: string;
  up: (queryInterface: QueryInterface, transaction: Transaction) => Promise<void>;
  down: (queryInterface: QueryInterface, transaction: Transaction) => Promise<void>;
};
