-- Limpieza de datos QA en TEST (10_CORRECCIONES §C6) · alcance común.
-- Lo incluyen los demás scripts con \ir DENTRO de su transacción. Solo crea
-- tablas TEMPORALES que desaparecen al terminar la transacción (ON COMMIT DROP).
--
-- Qué es «basura»:
--   * cuentas  qa-rutinas-%@example.test  (smoke de 1c)  y  %@load.test  (test/load)
--   * rutinas de esas cuentas
--   * rutinas con nombre EXACTO de las pruebas, de cualquier autor:
--       «QA Empuje <n>», «QA privada <n>», «Carrera <n>», «Activar <n>»
--     y todo lo que empiece por «QA-AUTO » (prefijo fijo de test/load desde R6)
--     (se exige el número final para no tocar una «Carrera 10K» real).
-- Las cuentas ya anonimizadas por 04 (baja-…@anonimo.invalid, marca en
-- nombre) siguen dentro del alcance para que 03/05 se puedan repetir.

CREATE TEMP TABLE qa_users ON COMMIT DROP AS
SELECT id, email, estado
  FROM public.usuarios
 WHERE email LIKE 'qa-rutinas-%@example.test'
    OR email LIKE '%@load.test'
    OR (email LIKE 'baja-%@anonimo.invalid' AND nombre_completo = 'Cuenta de prueba QA (anonimizada)');

CREATE TEMP TABLE qa_routines ON COMMIT DROP AS
SELECT r.id, r.nombre, r.visibilidad, r.created_by_user_id
  FROM training.routines r
 WHERE r.created_by_user_id IN (SELECT id FROM qa_users)
    OR r.nombre ~ '^(QA (Empuje|privada) [0-9]+|Carrera [0-9]+|Activar [0-9]+)$'
    OR r.nombre LIKE 'QA-AUTO %';

CREATE TEMP TABLE qa_comments ON COMMIT DROP AS
SELECT c.id
  FROM community.content_comments c
 WHERE c.autor_id IN (SELECT id FROM qa_users)
    OR (c.target_kind = 'ROUTINE' AND c.target_id IN (SELECT id FROM qa_routines));

CREATE TEMP TABLE qa_programs ON COMMIT DROP AS
SELECT p.id
  FROM training.training_programs p
 WHERE p.usuario_id IN (SELECT id FROM qa_users)
    OR p.routine_id IN (SELECT id FROM qa_routines);

CREATE TEMP TABLE qa_cardio ON COMMIT DROP AS
SELECT c.id FROM training.cardio_plans c WHERE c.usuario_id IN (SELECT id FROM qa_users);

-- Contenido cuyas valoraciones cambian al borrar (para recalcular el promedio).
CREATE TEMP TABLE qa_rated ON COMMIT DROP AS
SELECT DISTINCT target_kind, target_id
  FROM community.content_ratings
 WHERE usuario_id IN (SELECT id FROM qa_users)
   AND NOT (target_kind = 'ROUTINE' AND target_id IN (SELECT id FROM qa_routines));
