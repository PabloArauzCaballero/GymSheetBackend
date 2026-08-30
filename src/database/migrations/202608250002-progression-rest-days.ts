import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Días de descanso planificados.
 *
 * Antes, la racha perdonaba un único día de tolerancia genérica igual para
 * todo el mundo. Quien entrena de lunes a viernes y descansa el fin de semana
 * veía su racha romperse cada sábado, que es justo el comportamiento correcto
 * y no un descanso planificado. Esta tabla deja que cada persona declare qué
 * días de la semana no cuentan como una interrupción; el cálculo de la racha
 * (`computeStreaks`) revisa esos días al puentear un hueco en vez de asumir
 * un único día fijo para todos.
 *
 * Una fila por usuario, no una tabla de días sueltos: la preferencia es "estos
 * días de la semana, siempre", no un calendario de excepciones puntuales.
 */
const upStatements = [
  `CREATE TABLE IF NOT EXISTS progression.rest_day_preferences (
     usuario_id uuid PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
     -- ISO 8601: 1 = lunes ... 7 = domingo. Mismo criterio que EXTRACT(ISODOW ...),
     -- ya usado en progression.repository.ts para weekend_sessions.
     weekdays smallint[] NOT NULL DEFAULT '{}',
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
] as const;

const downStatements = [`DROP TABLE IF EXISTS progression.rest_day_preferences`] as const;

export const progressionRestDaysMigration: DatabaseMigration = {
  id: "202608250002-progression-rest-days",
  description:
    "Per-user planned rest weekdays that bridge a gap in the training streak instead of breaking it.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
