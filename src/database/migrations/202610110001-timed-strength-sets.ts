import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

/**
 * Series de fuerza por tiempo (plancha 45 s).
 *
 * `series_entrenamiento.duracion_seg` ya existe desde `202610080006` (integer,
 * 1–86400, para cardio), y `repeticiones`, `peso_kg` y `rir` ya admiten NULL.
 * Lo que impedía registrar una plancha era el CHECK `ck_serie_por_tipo`: una
 * serie de FUERZA exigía repeticiones, peso y RIR. Aquí se reescribe para
 * aceptar dos formas de serie de fuerza:
 *
 * - por repeticiones: repeticiones, peso y RIR obligatorios, sin duración
 *   (todas las filas existentes, porque la API nunca escribió duración en una
 *   serie de fuerza);
 * - por tiempo: duración 1–3600 s y repeticiones NULL; peso (lastre) y RIR
 *   opcionales.
 *
 * El cardio no cambia. Toda suma de kilos×repeticiones ya ignora estas filas:
 * `peso_kg * NULL` es NULL y SUM lo descarta.
 *
 * Rollback: `down` borra las series de fuerza por tiempo (no caben en el CHECK
 * anterior) y restaura el CHECK original. Es destructivo solo para esas filas.
 */
const STRENGTH_BY_REPS = `(repeticiones IS NOT NULL AND peso_kg IS NOT NULL AND rir IS NOT NULL AND duracion_seg IS NULL)`;
const STRENGTH_BY_TIME = `(repeticiones IS NULL AND duracion_seg BETWEEN 1 AND 3600)`;

const upStatements = [
  `ALTER TABLE public.series_entrenamiento DROP CONSTRAINT IF EXISTS ck_serie_por_tipo`,
  `ALTER TABLE public.series_entrenamiento
     ADD CONSTRAINT ck_serie_por_tipo CHECK (
       (tipo_serie = 'FUERZA' AND (${STRENGTH_BY_REPS} OR ${STRENGTH_BY_TIME}))
       OR (tipo_serie = 'CARDIO' AND duracion_seg IS NOT NULL))`,
] as const;

const downStatements = [
  `DELETE FROM public.series_entrenamiento WHERE tipo_serie = 'FUERZA' AND repeticiones IS NULL`,
  `ALTER TABLE public.series_entrenamiento DROP CONSTRAINT IF EXISTS ck_serie_por_tipo`,
  `ALTER TABLE public.series_entrenamiento
     ADD CONSTRAINT ck_serie_por_tipo CHECK (
       (tipo_serie = 'FUERZA' AND repeticiones IS NOT NULL AND peso_kg IS NOT NULL AND rir IS NOT NULL)
       OR (tipo_serie = 'CARDIO' AND duracion_seg IS NOT NULL))`,
] as const;

export const timedStrengthSetsMigration: DatabaseMigration = {
  id: '202610110001-timed-strength-sets',
  description: 'Strength sets logged by duration (timed exercises such as planks).',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
