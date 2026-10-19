import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

/**
 * Series saltadas, ejercicios omitidos y cierre idempotente de la sesión.
 *
 * - `series_saltadas`: una serie que la persona decidió no hacer, con su motivo.
 *   Va en su propia tabla y NO en `series_entrenamiento` a propósito: todo lo que
 *   suma kilos, repeticiones, récords, puntos o progresión lee esa tabla, y una
 *   fila «vacía» ahí obligaría a filtrar en cada consulta (riesgo R3 del plan).
 *   Aquí no cuenta para nada salvo para enseñarla.
 * - `sesiones_ejercicios.omitido_*`: el ejercicio entero se omitió esta sesión.
 *   Las series que ya tuviera siguen contando; omitir solo lo marca.
 * - `sesiones_entrenamiento.resultado_cierre`: lo que respondió `finish` (puntos,
 *   insignias, programa). Un segundo `finish` —doble toque, reintento con mala
 *   red— devuelve exactamente eso en vez de un 403 o de un premio vacío.
 */
const REASONS = `'CANSANCIO','PRISA','DOLOR','EQUIPO_OCUPADO','TECNICA','OTRO'`;

const upStatements = [
  `CREATE TABLE public.series_saltadas (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     sesion_ejercicio_id uuid NOT NULL REFERENCES public.sesiones_ejercicios(id) ON DELETE CASCADE,
     numero_serie integer NOT NULL,
     motivo varchar(16) NOT NULL,
     nota varchar(280),
     fecha_registro timestamptz NOT NULL DEFAULT now(),
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_saltada_numero CHECK (numero_serie BETWEEN 1 AND 100),
     CONSTRAINT ck_saltada_motivo CHECK (motivo IN (${REASONS})),
     CONSTRAINT uq_saltada_por_numero UNIQUE (sesion_ejercicio_id, numero_serie)
   )`,
  `ALTER TABLE public.sesiones_ejercicios
     ADD COLUMN omitido_motivo varchar(16),
     ADD COLUMN omitido_nota varchar(280),
     ADD COLUMN omitido_en timestamptz,
     ADD CONSTRAINT ck_sesion_ejercicio_omitido_motivo
       CHECK (omitido_motivo IS NULL OR omitido_motivo IN (${REASONS})),
     ADD CONSTRAINT ck_sesion_ejercicio_omitido_par
       CHECK ((omitido_motivo IS NULL) = (omitido_en IS NULL))`,
  `ALTER TABLE public.sesiones_entrenamiento ADD COLUMN resultado_cierre jsonb`,
] as const;

const downStatements = [
  `ALTER TABLE public.sesiones_entrenamiento DROP COLUMN IF EXISTS resultado_cierre`,
  `ALTER TABLE public.sesiones_ejercicios
     DROP CONSTRAINT IF EXISTS ck_sesion_ejercicio_omitido_par,
     DROP CONSTRAINT IF EXISTS ck_sesion_ejercicio_omitido_motivo,
     DROP COLUMN IF EXISTS omitido_en,
     DROP COLUMN IF EXISTS omitido_nota,
     DROP COLUMN IF EXISTS omitido_motivo`,
  `DROP TABLE IF EXISTS public.series_saltadas`,
] as const;

export const sessionSkipsMigration: DatabaseMigration = {
  id: '202610130001-session-skips',
  description: 'Skipped sets, omitted session exercises and idempotent session close.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
