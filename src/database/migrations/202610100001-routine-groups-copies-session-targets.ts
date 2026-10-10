import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

/**
 * M-C3 (PLAN_RUTINAS_REPP/10, correcciones del TestFlight):
 *
 * - `training.routine_exercises`: superseries/circuitos (`grupo`, `grupo_tipo`,
 *   `descanso_entre_seg`) y series por tiempo (`duracion_seg`). Con duración,
 *   las reps van a NULL (CHECK). Las rutinas existentes no cambian: todo es NULL.
 * - `training.routines.numero_copia`: el «vN» de «Guardar en mis rutinas» (C2).
 * - `public.ejercicios.nombre_es`: nombre en español cuando el dataset lo trae
 *   en inglés (C3.b). Se rellena con la biblioteca; el resto, con revisión humana.
 * - `public.sesiones_ejercicios`: copia del objetivo de la rutina, para que la
 *   sesión guíe aunque la rutina cambie después. Se quita la unicidad
 *   (sesion_id, ejercicio_id): un mismo ejercicio puede ir dos veces en un día.
 * - Huella: se recalcula para las rutinas públicas con el texto canónico nuevo.
 *   Un ejercicio sin grupo ni duración produce EXACTAMENTE el token antiguo, así
 *   que las huellas existentes no cambian y no puede haber choques nuevos.
 */
export const FINGERPRINT_SQL_V2 = `
  SELECT r.id AS routine_id,
         encode(sha256(convert_to(string_agg(d.linea, E'\\n' ORDER BY d.orden_dia), 'UTF8')), 'hex') AS huella
  FROM training.routines r
  JOIN (
    SELECT rd.routine_id,
           COALESCE(rd.dia_semana, 99) AS orden_dia,
           COALESCE(rd.dia_semana::text, 'x') || '|' || COALESCE((
             SELECT string_agg(
                      re.ejercicio_id::text || ':' || re.pos || ':' || re.series_objetivo || ':' ||
                      COALESCE(re.reps_min::text, '') || ':' || COALESCE(re.reps_max::text, '') ||
                      CASE WHEN re.grupo IS NULL AND re.duracion_seg IS NULL THEN ''
                           ELSE ':' || COALESCE(re.grupo::text, '') || ':' || COALESCE(re.duracion_seg::text, '')
                      END,
                      ',' ORDER BY re.pos)
             FROM (
               SELECT x.*, row_number() OVER (ORDER BY x.orden) AS pos
               FROM training.routine_exercises x
               WHERE x.routine_day_id = rd.id
             ) re
           ), '') AS linea
    FROM training.routine_days rd
  ) d ON d.routine_id = r.id
  GROUP BY r.id`;

const SESSION_TARGET_COLUMNS = [
  'series_objetivo',
  'reps_min',
  'reps_max',
  'peso_objetivo_kg',
  'rir_objetivo',
  'descanso_seg',
  'descanso_entre_seg',
  'duracion_seg',
  'grupo',
  'grupo_tipo',
];

const upStatements = [
  `ALTER TABLE training.routine_exercises
     ADD COLUMN IF NOT EXISTS grupo smallint,
     ADD COLUMN IF NOT EXISTS grupo_tipo varchar(12),
     ADD COLUMN IF NOT EXISTS descanso_entre_seg smallint,
     ADD COLUMN IF NOT EXISTS duracion_seg smallint`,
  `ALTER TABLE training.routine_exercises
     ADD CONSTRAINT ck_routine_exercise_grupo CHECK (grupo IS NULL OR grupo BETWEEN 1 AND 30),
     ADD CONSTRAINT ck_routine_exercise_grupo_tipo CHECK (
       (grupo IS NULL AND grupo_tipo IS NULL)
       OR (grupo IS NOT NULL AND grupo_tipo IN ('SUPERSERIE','CIRCUITO'))
     ),
     ADD CONSTRAINT ck_routine_exercise_descanso_entre CHECK (descanso_entre_seg IS NULL OR descanso_entre_seg BETWEEN 0 AND 60),
     ADD CONSTRAINT ck_routine_exercise_duracion CHECK (duracion_seg IS NULL OR duracion_seg BETWEEN 1 AND 3600),
     ADD CONSTRAINT ck_routine_exercise_duracion_reps CHECK (
       duracion_seg IS NULL OR (reps_min IS NULL AND reps_max IS NULL)
     )`,
  `ALTER TABLE training.routines ADD COLUMN IF NOT EXISTS numero_copia smallint`,
  `ALTER TABLE training.routines
     ADD CONSTRAINT ck_routine_numero_copia CHECK (numero_copia IS NULL OR numero_copia >= 1)`,
  `CREATE INDEX IF NOT EXISTS ix_routines_copias_de_usuario
     ON training.routines(created_by_user_id, basada_en_rutina_id) WHERE basada_en_rutina_id IS NOT NULL`,
  `ALTER TABLE public.ejercicios ADD COLUMN IF NOT EXISTS nombre_es varchar(160)`,
  `ALTER TABLE public.sesiones_ejercicios
     ADD COLUMN IF NOT EXISTS series_objetivo smallint,
     ADD COLUMN IF NOT EXISTS reps_min smallint,
     ADD COLUMN IF NOT EXISTS reps_max smallint,
     ADD COLUMN IF NOT EXISTS peso_objetivo_kg numeric(7,2),
     ADD COLUMN IF NOT EXISTS rir_objetivo smallint,
     ADD COLUMN IF NOT EXISTS descanso_seg integer,
     ADD COLUMN IF NOT EXISTS descanso_entre_seg smallint,
     ADD COLUMN IF NOT EXISTS duracion_seg smallint,
     ADD COLUMN IF NOT EXISTS grupo smallint,
     ADD COLUMN IF NOT EXISTS grupo_tipo varchar(12)`,
  `ALTER TABLE public.sesiones_ejercicios
     ADD CONSTRAINT ck_session_exercise_grupo_tipo CHECK (grupo_tipo IS NULL OR grupo_tipo IN ('SUPERSERIE','CIRCUITO'))`,
  `DROP INDEX IF EXISTS public.uq_session_exercise_identity`,
  `CREATE INDEX IF NOT EXISTS ix_session_exercise_identity ON public.sesiones_ejercicios (sesion_id, ejercicio_id)`,
  // Recalcula la huella de las públicas. Hoy ninguna tiene grupo ni duración, así
  // que el resultado coincide con la huella guardada; solo se escriben las que difieran.
  `UPDATE training.routines r SET huella = f.huella
     FROM (${FINGERPRINT_SQL_V2}) f
     WHERE f.routine_id = r.id AND r.visibilidad = 'PUBLIC' AND r.huella IS DISTINCT FROM f.huella`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS public.ix_session_exercise_identity`,
  // Si ya hay sesiones con un ejercicio repetido, el índice no se puede rehacer: se avisa con el error.
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_session_exercise_identity
     ON public.sesiones_ejercicios (sesion_id, ejercicio_id)`,
  `ALTER TABLE public.sesiones_ejercicios DROP CONSTRAINT IF EXISTS ck_session_exercise_grupo_tipo`,
  `ALTER TABLE public.sesiones_ejercicios ${SESSION_TARGET_COLUMNS.map((c) => `DROP COLUMN IF EXISTS ${c}`).join(', ')}`,
  `ALTER TABLE public.ejercicios DROP COLUMN IF EXISTS nombre_es`,
  `DROP INDEX IF EXISTS training.ix_routines_copias_de_usuario`,
  `ALTER TABLE training.routines DROP CONSTRAINT IF EXISTS ck_routine_numero_copia`,
  `ALTER TABLE training.routines DROP COLUMN IF EXISTS numero_copia`,
  `ALTER TABLE training.routine_exercises
     DROP CONSTRAINT IF EXISTS ck_routine_exercise_duracion_reps,
     DROP CONSTRAINT IF EXISTS ck_routine_exercise_duracion,
     DROP CONSTRAINT IF EXISTS ck_routine_exercise_descanso_entre,
     DROP CONSTRAINT IF EXISTS ck_routine_exercise_grupo_tipo,
     DROP CONSTRAINT IF EXISTS ck_routine_exercise_grupo`,
  `ALTER TABLE training.routine_exercises
     DROP COLUMN IF EXISTS duracion_seg, DROP COLUMN IF EXISTS descanso_entre_seg,
     DROP COLUMN IF EXISTS grupo_tipo, DROP COLUMN IF EXISTS grupo`,
] as const;

export const routineGroupsCopiesSessionTargetsMigration: DatabaseMigration = {
  id: '202610100001-routine-groups-copies-session-targets',
  description:
    'Routine supersets/circuits and timed sets, copy number, exercise Spanish name and session targets (M-C3).',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
