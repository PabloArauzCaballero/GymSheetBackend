import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

/**
 * Rutinas v2 (plan PLAN_RUTINAS_REPP, F1): días por rutina, publicación,
 * copia con atribución y huella para impedir duplicados públicos.
 *
 * `visibilidad` es varchar + CHECK (no un ENUM de Postgres), así que añadir
 * `PUBLIC` es cambiar el CHECK. `TEMPLATE` se conserva en el CHECK para no
 * invalidar bases antiguas; el código deja de escribirlo y la API lo rechaza.
 *
 * La huella se calcula aquí con el MISMO texto canónico que
 * `routine-fingerprint.ts` (ver ese archivo): una línea por día,
 * `dia|ejercicio:posicion:series:repsMin:repsMax,…`.
 */
const FINGERPRINT_SQL = `
  SELECT r.id AS routine_id,
         encode(sha256(convert_to(string_agg(d.linea, E'\\n' ORDER BY d.orden_dia), 'UTF8')), 'hex') AS huella
  FROM training.routines r
  JOIN (
    SELECT rd.routine_id,
           COALESCE(rd.dia_semana, 99) AS orden_dia,
           COALESCE(rd.dia_semana::text, 'x') || '|' || COALESCE((
             SELECT string_agg(
                      re.ejercicio_id::text || ':' || re.pos || ':' || re.series_objetivo || ':' ||
                      COALESCE(re.reps_min::text, '') || ':' || COALESCE(re.reps_max::text, ''),
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

const upStatements = [
  `ALTER TABLE training.routines DROP CONSTRAINT IF EXISTS ck_routine_visibility`,
  `ALTER TABLE training.routines ADD CONSTRAINT ck_routine_visibility
     CHECK (visibilidad IN ('PRIVATE','SHARED','TEMPLATE','PUBLIC'))`,
  `ALTER TABLE training.routines
     ADD COLUMN IF NOT EXISTS duracion_semanas smallint,
     ADD COLUMN IF NOT EXISTS es_oficial boolean NOT NULL DEFAULT false,
     ADD COLUMN IF NOT EXISTS basada_en_rutina_id uuid REFERENCES training.routines(id) ON DELETE SET NULL,
     ADD COLUMN IF NOT EXISTS basada_en_version integer,
     ADD COLUMN IF NOT EXISTS atribucion jsonb,
     ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
     ADD COLUMN IF NOT EXISTS huella char(64),
     ADD COLUMN IF NOT EXISTS publicada_en timestamptz,
     ADD COLUMN IF NOT EXISTS estado_moderacion varchar(20) NOT NULL DEFAULT 'VISIBLE',
     ADD COLUMN IF NOT EXISTS progresion_config jsonb NOT NULL DEFAULT '{}'::jsonb,
     ADD COLUMN IF NOT EXISTS tenant_id_autor varchar(60),
     ADD COLUMN IF NOT EXISTS valoracion_promedio numeric(3,2),
     ADD COLUMN IF NOT EXISTS valoracion_total integer NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS copias_total integer NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS activaciones_total integer NOT NULL DEFAULT 0`,
  `ALTER TABLE training.routines
     ADD CONSTRAINT ck_routine_duracion CHECK (duracion_semanas IS NULL OR duracion_semanas BETWEEN 1 AND 52),
     ADD CONSTRAINT ck_routine_moderacion CHECK (estado_moderacion IN ('VISIBLE','OCULTA_AUTO','OCULTA_MODERACION'))`,
  `CREATE TABLE training.routine_days (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     routine_id uuid NOT NULL REFERENCES training.routines(id) ON DELETE CASCADE,
     dia_semana smallint,
     nombre varchar(60),
     orden smallint NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_routine_day_dia CHECK (dia_semana IS NULL OR dia_semana BETWEEN 1 AND 7)
   )`,
  `CREATE UNIQUE INDEX uq_routine_days_dia ON training.routine_days(routine_id, dia_semana) WHERE dia_semana IS NOT NULL`,
  `CREATE INDEX ix_routine_days_routine ON training.routine_days(routine_id, orden)`,
  `ALTER TABLE training.routine_exercises
     ADD COLUMN IF NOT EXISTS routine_day_id uuid REFERENCES training.routine_days(id) ON DELETE CASCADE`,
  `CREATE INDEX ix_routine_exercises_day ON training.routine_exercises(routine_day_id, orden)`,
  `CREATE TABLE training.routine_week_overrides (
     routine_id uuid NOT NULL REFERENCES training.routines(id) ON DELETE CASCADE,
     semana_numero smallint NOT NULL,
     es_descarga boolean NOT NULL DEFAULT false,
     factor_volumen numeric(3,2) NOT NULL DEFAULT 1.00,
     factor_carga numeric(3,2) NOT NULL DEFAULT 1.00,
     nota varchar(200),
     PRIMARY KEY (routine_id, semana_numero),
     CONSTRAINT ck_week_override_semana CHECK (semana_numero BETWEEN 1 AND 52),
     CONSTRAINT ck_week_override_volumen CHECK (factor_volumen BETWEEN 0.30 AND 1.50),
     CONSTRAINT ck_week_override_carga CHECK (factor_carga BETWEEN 0.50 AND 1.20)
   )`,

  // --- Paso de datos (idempotente: solo toca rutinas sin días) ---
  `INSERT INTO training.routine_days (routine_id, dia_semana, nombre, orden)
     SELECT r.id, NULL, NULL, 1 FROM training.routines r
     WHERE NOT EXISTS (SELECT 1 FROM training.routine_days d WHERE d.routine_id = r.id)`,
  `UPDATE training.routine_exercises re
     SET routine_day_id = d.id
     FROM training.routine_days d
     WHERE d.routine_id = re.routine_id AND re.routine_day_id IS NULL`,
  `UPDATE training.routines r
     SET tenant_id_autor = u.tenant_id
     FROM public.usuarios u
     WHERE u.id = r.created_by_user_id AND r.tenant_id_autor IS NULL`,
  `UPDATE training.routines r SET huella = f.huella
     FROM (${FINGERPRINT_SQL}) f
     WHERE f.routine_id = r.id AND r.huella IS NULL`,
  // TEMPLATE -> PUBLIC. De dos plantillas idénticas la más antigua queda pública
  // y la otra pasa a PRIVATE con una nota en metadata (informe de la migración).
  `WITH ranked AS (
       SELECT r.id, r.huella,
              row_number() OVER (PARTITION BY r.huella ORDER BY r.created_at, r.id) AS rn,
              first_value(r.id) OVER (PARTITION BY r.huella ORDER BY r.created_at, r.id) AS primera
       FROM training.routines r
       WHERE r.visibilidad = 'TEMPLATE' AND r.estado = 'ACTIVE'
     )
     UPDATE training.routines r
     SET visibilidad = CASE WHEN ranked.rn = 1 THEN 'PUBLIC' ELSE 'PRIVATE' END,
         publicada_en = CASE WHEN ranked.rn = 1 THEN r.updated_at ELSE NULL END,
         metadata = CASE WHEN ranked.rn = 1 THEN r.metadata
                         ELSE r.metadata || jsonb_build_object('migracion', 'duplicado-de:' || ranked.primera::text) END
     FROM ranked WHERE ranked.id = r.id`,
  `UPDATE training.routines r SET visibilidad = 'PRIVATE'
     WHERE r.visibilidad = 'TEMPLATE'`,
  `UPDATE training.routines r SET es_oficial = true
     FROM public.usuarios u
     WHERE u.id = r.created_by_user_id AND u.rol = 'SYSTEM_ADMIN' AND r.visibilidad = 'PUBLIC'`,

  // D1/DD-5: no puede haber dos públicas activas y visibles con la misma huella.
  `CREATE UNIQUE INDEX uq_routines_publicas_huella ON training.routines(huella)
     WHERE visibilidad = 'PUBLIC' AND estado = 'ACTIVE' AND estado_moderacion = 'VISIBLE'`,
  `CREATE INDEX ix_routines_catalogo ON training.routines(visibilidad, es_oficial, estado, estado_moderacion, publicada_en DESC)`,
  `CREATE INDEX ix_routines_basada_en ON training.routines(basada_en_rutina_id) WHERE basada_en_rutina_id IS NOT NULL`,
] as const;

const downStatements = [
  `DROP INDEX IF EXISTS training.ix_routines_basada_en`,
  `DROP INDEX IF EXISTS training.ix_routines_catalogo`,
  `DROP INDEX IF EXISTS training.uq_routines_publicas_huella`,
  `DROP TABLE IF EXISTS training.routine_week_overrides`,
  `ALTER TABLE training.routine_exercises DROP COLUMN IF EXISTS routine_day_id`,
  `DROP TABLE IF EXISTS training.routine_days`,
  `UPDATE training.routines SET visibilidad = 'SHARED' WHERE visibilidad = 'PUBLIC'`,
  `ALTER TABLE training.routines DROP CONSTRAINT IF EXISTS ck_routine_moderacion`,
  `ALTER TABLE training.routines DROP CONSTRAINT IF EXISTS ck_routine_duracion`,
  `ALTER TABLE training.routines
     DROP COLUMN IF EXISTS activaciones_total, DROP COLUMN IF EXISTS copias_total,
     DROP COLUMN IF EXISTS valoracion_total, DROP COLUMN IF EXISTS valoracion_promedio,
     DROP COLUMN IF EXISTS tenant_id_autor, DROP COLUMN IF EXISTS progresion_config,
     DROP COLUMN IF EXISTS estado_moderacion, DROP COLUMN IF EXISTS publicada_en,
     DROP COLUMN IF EXISTS huella, DROP COLUMN IF EXISTS version,
     DROP COLUMN IF EXISTS atribucion, DROP COLUMN IF EXISTS basada_en_version,
     DROP COLUMN IF EXISTS basada_en_rutina_id, DROP COLUMN IF EXISTS es_oficial,
     DROP COLUMN IF EXISTS duracion_semanas`,
  `ALTER TABLE training.routines DROP CONSTRAINT IF EXISTS ck_routine_visibility`,
  `ALTER TABLE training.routines ADD CONSTRAINT ck_routine_visibility
     CHECK (visibilidad IN ('PRIVATE','SHARED','TEMPLATE'))`,
] as const;

export const routinesV2StructureMigration: DatabaseMigration = {
  id: '202610080001-routines-v2-structure',
  description:
    'Routines v2: days per routine, week overrides, publication, copy attribution and duplicate fingerprint.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
