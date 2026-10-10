-- 01 · INVENTARIO (solo lectura). Ejecutar en una COPIA de TEST antes de nada:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 01_inventario.sql
-- Las tablas temporales viven solo en esta sesión: no escribe nada persistente.
\set ON_ERROR_STOP on
-- No es READ ONLY porque Postgres no deja crear tablas temporales en una transacción
-- de solo lectura; no escribe nada persistente y siempre termina en ROLLBACK.
BEGIN;
\ir 00_alcance.sql

\echo '== Resumen'
SELECT 'cuentas'                AS que, count(*) FROM qa_users
UNION ALL SELECT 'cuentas activas',        count(*) FROM qa_users WHERE estado = 'ACTIVO'
UNION ALL SELECT 'rutinas',                count(*) FROM qa_routines
UNION ALL SELECT 'rutinas públicas',       count(*) FROM qa_routines WHERE visibilidad = 'PUBLIC'
UNION ALL SELECT 'copias de rutinas QA (de otras personas, NO se borran)',
          count(*) FROM training.routines WHERE basada_en_rutina_id IN (SELECT id FROM qa_routines) AND id NOT IN (SELECT id FROM qa_routines)
UNION ALL SELECT 'programas',              count(*) FROM qa_programs
UNION ALL SELECT 'líneas de ledger',       count(*) FROM training.mode_reward_ledger WHERE program_id IN (SELECT id FROM qa_programs)
UNION ALL SELECT 'valoraciones',           count(*) FROM community.content_ratings
          WHERE usuario_id IN (SELECT id FROM qa_users) OR (target_kind = 'ROUTINE' AND target_id IN (SELECT id FROM qa_routines))
UNION ALL SELECT 'comentarios',            count(*) FROM qa_comments
UNION ALL SELECT 'denuncias sobre ese contenido', count(*) FROM moderation.reports
          WHERE (target_kind = 'ROUTINE' AND target_id IN (SELECT id FROM qa_routines)) OR (target_kind = 'COMMENT' AND target_id IN (SELECT id FROM qa_comments))
UNION ALL SELECT 'planes de cardio',       count(*) FROM qa_cardio
UNION ALL SELECT 'contenido ajeno con promedio afectado', count(*) FROM qa_rated;

\echo '== Cuentas por patrón'
SELECT CASE WHEN email LIKE '%@load.test' THEN '@load.test' WHEN email LIKE 'baja-%' THEN 'ya anonimizada' ELSE 'qa-rutinas-@example.test' END AS patron,
       estado, count(*)
  FROM qa_users GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== Rutinas (nombre, visibilidad, valoración, copias)'
SELECT r.nombre, r.visibilidad, r.valoracion_promedio, r.valoracion_total, r.copias_total, u.email AS autor
  FROM training.routines r JOIN public.usuarios u ON u.id = r.created_by_user_id
 WHERE r.id IN (SELECT id FROM qa_routines)
 ORDER BY r.visibilidad DESC, r.created_at DESC
 LIMIT 200;

\echo '== Contenido ajeno valorado por cuentas QA (se recalcula en 03)'
SELECT q.target_kind, q.target_id, coalesce(r.nombre, e.nombre) AS nombre
  FROM qa_rated q
  LEFT JOIN training.routines r ON q.target_kind = 'ROUTINE' AND r.id = q.target_id
  LEFT JOIN public.ejercicios e ON q.target_kind = 'EXERCISE' AND e.id = q.target_id;

ROLLBACK;
