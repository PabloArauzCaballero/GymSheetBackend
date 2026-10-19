-- 02 · OCULTAR de inmediato (reversible): las rutinas QA públicas pasan a PRIVATE
-- y dejan de ser oficiales. Para deshacer, su autor puede volver a publicarlas.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 02_ocultar.sql
\set ON_ERROR_STOP on
BEGIN;
\ir 00_alcance.sql

UPDATE training.routines r
   SET visibilidad = 'PRIVATE', publicada_en = NULL, es_oficial = false, updated_at = now()
 WHERE r.id IN (SELECT id FROM qa_routines)
   AND r.visibilidad = 'PUBLIC'
RETURNING r.id, r.nombre;

COMMIT;
