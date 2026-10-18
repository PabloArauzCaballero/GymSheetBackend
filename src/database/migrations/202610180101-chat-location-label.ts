import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Un lugar elegido en el mapa viaja con su nombre («Gimnasio X · Calle Y»):
 * sin la etiqueta, la burbuja solo podía decir «Ubicación compartida».
 */
const upStatements = [
  `ALTER TABLE chat.messages ADD COLUMN location_label varchar(180)`,
] as const;

const downStatements = [
  `ALTER TABLE chat.messages DROP COLUMN location_label`,
] as const;

export const chatLocationLabelMigration: DatabaseMigration = {
  id: "202610180101-chat-location-label",
  description: "Stores the human label of a place shared in a chat location message.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
