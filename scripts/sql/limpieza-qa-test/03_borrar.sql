-- 03 · BORRAR en UNA transacción (después de pg_dump y de ensayarlo en una copia).
-- Orden obligatorio: training_programs.routine_id y mode_reward_ledger.program_id
-- no tienen ON DELETE, y valoraciones/comentarios son polimórficos sin FK.
--   1 ledger · 2 programas · 3 valoraciones · 4 comentarios (+ denuncias) ·
--   5 rutinas · 6 planes de cardio · 7 recalcular valoraciones afectadas
-- Las cuentas NO se borran (10 tablas con RESTRICT): ver 04.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 03_borrar.sql
\set ON_ERROR_STOP on
BEGIN;
\ir 00_alcance.sql

\echo '1 · ledger'
DELETE FROM training.mode_reward_ledger WHERE program_id IN (SELECT id FROM qa_programs);
\echo '2 · programas (semanas y levantamientos caen en cascada; las sesiones quedan con program_id NULL)'
DELETE FROM training.training_programs WHERE id IN (SELECT id FROM qa_programs);
\echo '3 · valoraciones'
DELETE FROM community.content_ratings
 WHERE usuario_id IN (SELECT id FROM qa_users)
    OR (target_kind = 'ROUTINE' AND target_id IN (SELECT id FROM qa_routines));
\echo '4 · comentarios (las respuestas caen en cascada) y denuncias sobre el contenido QA'
DELETE FROM moderation.reports
 WHERE (target_kind = 'ROUTINE' AND target_id IN (SELECT id FROM qa_routines))
    OR (target_kind = 'COMMENT' AND target_id IN (SELECT id FROM qa_comments));
DELETE FROM community.content_comments WHERE id IN (SELECT id FROM qa_comments);
\echo '5 · rutinas (días, ejercicios, invitaciones, asignaciones y ajustes caen en cascada)'
DELETE FROM training.routines WHERE id IN (SELECT id FROM qa_routines);
\echo '6 · planes de cardio'
DELETE FROM training.cardio_plans WHERE id IN (SELECT id FROM qa_cardio);
\echo '7 · recalcular el promedio del contenido ajeno que habían valorado (misma fórmula que CommunityRepository.recompute)'
UPDATE training.routines t
   SET valoracion_total = s.total, valoracion_promedio = s.promedio
  FROM (SELECT q.target_id,
               count(cr.usuario_id)::int AS total,
               round(avg(cr.estrellas)::numeric, 2) AS promedio
          FROM qa_rated q
          LEFT JOIN community.content_ratings cr ON cr.target_kind = q.target_kind AND cr.target_id = q.target_id
         WHERE q.target_kind = 'ROUTINE'
         GROUP BY q.target_id) s
 WHERE t.id = s.target_id;
UPDATE public.ejercicios t
   SET valoracion_total = s.total, valoracion_promedio = s.promedio
  FROM (SELECT q.target_id,
               count(cr.usuario_id)::int AS total,
               round(avg(cr.estrellas)::numeric, 2) AS promedio
          FROM qa_rated q
          LEFT JOIN community.content_ratings cr ON cr.target_kind = q.target_kind AND cr.target_id = q.target_id
         WHERE q.target_kind = 'EXERCISE'
         GROUP BY q.target_id) s
 WHERE t.id = s.target_id;

COMMIT;
