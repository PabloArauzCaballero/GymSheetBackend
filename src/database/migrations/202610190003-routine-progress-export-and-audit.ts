import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

/**
 * Sistema de Exportación de Progreso de Rutinas y Auditoría Histórica:
 * 1. Tabla `training.routine_progress_download_audits` para trazabilidad de cada descarga.
 * 2. Vista SQL `training.v_routine_progress_export` para consolidación de todas las dimensiones
 *    del sistema de rutinas (metadatos, autoría, días, prescripción de ejercicios, sobrecarga
 *    progresiva en programas activos y series reales ejecutadas).
 * 3. Vista SQL `training.v_audit_routine_progress_downloads` para inspección de auditoría.
 */
const upStatements = [
  // 1. Tabla de auditoría de descargas de progreso
  `CREATE TABLE IF NOT EXISTS training.routine_progress_download_audits (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     routine_id uuid REFERENCES training.routines(id) ON DELETE SET NULL,
     format varchar(10) NOT NULL,
     filters jsonb NOT NULL DEFAULT '{}'::jsonb,
     file_name varchar(255) NOT NULL,
     records_count integer NOT NULL DEFAULT 0,
     ip varchar(60),
     user_agent text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE INDEX IF NOT EXISTS ix_routine_progress_download_audits_user
     ON training.routine_progress_download_audits(user_id, created_at DESC)`,

  `CREATE INDEX IF NOT EXISTS ix_routine_progress_download_audits_created
     ON training.routine_progress_download_audits(created_at DESC)`,

  // 2. Vista consolidada de progreso del sistema de rutinas con todos los campos
  `CREATE OR REPLACE VIEW training.v_routine_progress_export AS
   SELECT
     -- Atleta / Usuario
     COALESCE(se.usuario_id, r.created_by_user_id) AS usuario_id,
     u_atleta.email AS usuario_email,
     u_atleta.nombre_completo AS usuario_nombre,

     -- Rutina
     r.id AS rutina_id,
     r.nombre AS rutina_nombre,
     r.descripcion AS rutina_descripcion,
     r.visibilidad AS rutina_visibilidad,
     r.objetivo AS rutina_objetivo,
     r.duracion_semanas AS rutina_duracion_semanas,
     r.version AS rutina_version,
     r.es_oficial AS rutina_es_oficial,
     r.estado AS rutina_estado,
     r.huella AS rutina_huella,
     r.publicada_en AS rutina_publicada_en,
     r.created_at AS rutina_creada_en,
     u_autor.id AS rutina_autor_id,
     u_autor.nombre_completo AS rutina_autor_nombre,
     u_autor.email AS rutina_autor_email,
     CASE
       WHEN r.atribucion IS NOT NULL THEN (r.atribucion->>'routineName') || ' por ' || (r.atribucion->>'authorName')
       ELSE NULL
     END AS rutina_atribucion_original,

     -- Día de la rutina
     rd.id AS dia_id,
     rd.nombre AS dia_nombre,
     rd.dia_semana AS dia_semana_numero,
     CASE rd.dia_semana
       WHEN 1 THEN 'Lunes'
       WHEN 2 THEN 'Martes'
       WHEN 3 THEN 'Miércoles'
       WHEN 4 THEN 'Jueves'
       WHEN 5 THEN 'Viernes'
       WHEN 6 THEN 'Sábado'
       WHEN 7 THEN 'Domingo'
       ELSE 'Cualquier día'
     END AS dia_semana_nombre,
     rd.orden AS dia_orden,

     -- Prescripción del Ejercicio
     e.id AS ejercicio_id,
     e.nombre AS ejercicio_nombre,
     e.grupo_muscular AS ejercicio_grupo_muscular,
     e.target_muscle AS ejercicio_musculo_objetivo,
     e.tipo_ejercicio AS ejercicio_tipo,
     e.required_equipment AS ejercicio_equipamiento,
     re.orden AS ejercicio_orden,
     re.series_objetivo AS prescripcion_series,
     re.reps_min AS prescripcion_reps_min,
     re.reps_max AS prescripcion_reps_max,
     CASE
       WHEN re.reps_min IS NOT NULL AND re.reps_max IS NOT NULL THEN re.reps_min || ' - ' || re.reps_max
       WHEN re.reps_min IS NOT NULL THEN re.reps_min::text
       WHEN re.reps_max IS NOT NULL THEN re.reps_max::text
       ELSE NULL
     END AS prescripcion_reps_rango,
     re.peso_objetivo_kg AS prescripcion_peso_objetivo_kg,
     re.rir_objetivo AS prescripcion_rir_objetivo,
     re.descanso_seg AS prescripcion_descanso_seg,
     re.nota AS prescripcion_nota,

     -- Programa Activo y Sobrecarga Progresiva (si aplica)
     tp.id AS programa_id,
     tp.carril AS programa_carril,
     tp.modo AS programa_modo,
     tp.estado AS programa_estado,
     tp.multiplicador_actual AS programa_multiplicador,
     plt.peso_trabajo_kg AS sobrecarga_peso_trabajo_kg,
     plt.peso_sugerido_kg AS sobrecarga_peso_sugerido_kg,
     plt.e1rm_inicial_kg AS sobrecarga_e1rm_inicial_kg,
     plt.e1rm_actual_kg AS sobrecarga_e1rm_actual_kg,
     plt.marca_meta_kg AS sobrecarga_marca_meta_kg,
     plt.fallos_seguidos AS sobrecarga_fallos_seguidos,

     -- Sesión Real Ejecutada
     se.id AS sesion_id,
     se.fecha_inicio AS sesion_fecha_inicio,
     se.fecha_fin AS sesion_fecha_fin,
     ROUND(EXTRACT(EPOCH FROM (se.fecha_fin - se.fecha_inicio)) / 60, 1) AS sesion_duracion_min,
     se.estado AS sesion_estado,
     se.observacion AS sesion_observacion,
     se.geo_verified AS sesion_geo_verificada,
     sex.es_enfasis AS sesion_ejercicio_es_enfasis,

     -- Serie Real Ejecutada
     sset.id AS serie_id,
     sset.numero_serie AS serie_numero,
     sset.repeticiones AS serie_repeticiones_logradas,
     sset.peso_kg AS serie_peso_levantado_kg,
     (COALESCE(sset.repeticiones, 0) * COALESCE(sset.peso_kg, 0)) AS serie_volumen_kg,
     sset.rir AS serie_rir_real,
     sset.rpe AS serie_rpe_real,
     sset.descanso_seg_anterior AS serie_descanso_seg_previo,
     sset.tipo_serie AS serie_tipo,
     sset.duracion_seg AS serie_cardio_duracion_seg,
     sset.distancia_m AS serie_cardio_distancia_m,
     sset.fc_media AS serie_cardio_fc_media,
     sset.fecha_registro AS serie_registrada_en

   FROM training.routines r
   LEFT JOIN public.usuarios u_autor ON r.created_by_user_id = u_autor.id
   LEFT JOIN training.routine_days rd ON rd.routine_id = r.id
   LEFT JOIN training.routine_exercises re ON re.routine_id = r.id AND (re.routine_day_id = rd.id OR (re.routine_day_id IS NULL AND rd.orden = 1))
   LEFT JOIN public.ejercicios e ON re.ejercicio_id = e.id
   LEFT JOIN training.training_programs tp ON tp.routine_id = r.id AND tp.estado = 'ACTIVE'
   LEFT JOIN training.program_lift_targets plt ON plt.program_id = tp.id AND plt.ejercicio_id = e.id
   LEFT JOIN public.sesiones_entrenamiento se ON (se.routine_id = r.id)
   LEFT JOIN public.usuarios u_atleta ON COALESCE(se.usuario_id, r.created_by_user_id) = u_atleta.id
   LEFT JOIN public.sesiones_ejercicios sex ON sex.sesion_id = se.id AND sex.ejercicio_id = e.id
   LEFT JOIN public.series_entrenamiento sset ON sset.sesion_ejercicio_id = sex.id`,

  // 3. Vista de auditoría de descargas de progreso
  `CREATE OR REPLACE VIEW training.v_audit_routine_progress_downloads AS
   SELECT
     a.id AS audit_id,
     a.created_at AS downloaded_at,
     a.user_id,
     u.email AS user_email,
     u.nombre_completo AS user_full_name,
     u.rol AS user_role,
     u.tenant_id,
     a.format,
     a.file_name,
     a.records_count,
     a.routine_id,
     r.nombre AS routine_name,
     a.filters,
     a.ip,
     a.user_agent
   FROM training.routine_progress_download_audits a
   INNER JOIN public.usuarios u ON a.user_id = u.id
   LEFT JOIN training.routines r ON a.routine_id = r.id`,
];

const downStatements = [
  `DROP VIEW IF EXISTS training.v_audit_routine_progress_downloads`,
  `DROP VIEW IF EXISTS training.v_routine_progress_export`,
  `DROP TABLE IF EXISTS training.routine_progress_download_audits CASCADE`,
];

export const routineProgressExportAndAuditMigration: DatabaseMigration = {
  id: '202610190003-routine-progress-export-and-audit',
  description: 'Auditoría de descarga y vistas SQL de exportación de progreso de rutinas',
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
