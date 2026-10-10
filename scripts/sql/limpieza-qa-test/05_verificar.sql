-- 05 · VERIFICAR (solo lectura). Todo debe dar 0 salvo «cuentas anonimizadas».
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 05_verificar.sql
\set ON_ERROR_STOP on
-- No es READ ONLY porque Postgres no deja crear tablas temporales en una transacción
-- de solo lectura; no escribe nada persistente y siempre termina en ROLLBACK.
BEGIN;
\ir 00_alcance.sql

SELECT 'cuentas QA activas o con su correo original' AS comprobacion, count(*) AS n
  FROM qa_users WHERE estado <> 'INACTIVO' OR email NOT LIKE 'baja-%@anonimo.invalid'
UNION ALL SELECT 'rutinas QA',                         count(*) FROM qa_routines
UNION ALL SELECT 'rutinas QA en el catálogo público',  count(*) FROM training.routines
           WHERE visibilidad = 'PUBLIC' AND estado = 'ACTIVE' AND nombre ~ '^(QA |QA-AUTO |Carrera [0-9]+$|Activar [0-9]+$)'
UNION ALL SELECT 'programas QA',                       count(*) FROM qa_programs
UNION ALL SELECT 'planes de cardio QA',                count(*) FROM qa_cardio
UNION ALL SELECT 'valoraciones huérfanas (rutina)',    count(*) FROM community.content_ratings cr
           WHERE cr.target_kind = 'ROUTINE' AND NOT EXISTS (SELECT 1 FROM training.routines r WHERE r.id = cr.target_id)
UNION ALL SELECT 'valoraciones huérfanas (ejercicio)', count(*) FROM community.content_ratings cr
           WHERE cr.target_kind = 'EXERCISE' AND NOT EXISTS (SELECT 1 FROM public.ejercicios e WHERE e.id = cr.target_id)
UNION ALL SELECT 'comentarios huérfanos (rutina)',     count(*) FROM community.content_comments c
           WHERE c.target_kind = 'ROUTINE' AND NOT EXISTS (SELECT 1 FROM training.routines r WHERE r.id = c.target_id)
UNION ALL SELECT 'comentarios huérfanos (ejercicio)',  count(*) FROM community.content_comments c
           WHERE c.target_kind = 'EXERCISE' AND NOT EXISTS (SELECT 1 FROM public.ejercicios e WHERE e.id = c.target_id)
UNION ALL SELECT 'ledger sin programa',                count(*) FROM training.mode_reward_ledger l
           WHERE NOT EXISTS (SELECT 1 FROM training.training_programs p WHERE p.id = l.program_id)
UNION ALL SELECT 'promedios desalineados (rutinas)',   count(*) FROM training.routines r
           WHERE r.valoracion_total <> (SELECT count(*) FROM community.content_ratings cr WHERE cr.target_kind = 'ROUTINE' AND cr.target_id = r.id)
              OR r.valoracion_promedio IS DISTINCT FROM (SELECT round(avg(estrellas)::numeric, 2) FROM community.content_ratings cr WHERE cr.target_kind = 'ROUTINE' AND cr.target_id = r.id)
UNION ALL SELECT 'cuentas anonimizadas (informativo)', count(*) FROM qa_users WHERE email LIKE 'baja-%@anonimo.invalid';

ROLLBACK;
