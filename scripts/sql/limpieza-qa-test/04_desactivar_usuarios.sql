-- 04 · DESACTIVAR y ANONIMIZAR las cuentas QA (no se borran: 10 tablas con RESTRICT).
-- Correo → baja-<id>@anonimo.invalid, nombre fijo, contraseña inutilizable,
-- sesiones (refresh tokens) revocadas. Idempotente.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 04_desactivar_usuarios.sql
\set ON_ERROR_STOP on
BEGIN;
\ir 00_alcance.sql

DELETE FROM auth.refresh_tokens WHERE user_id IN (SELECT id FROM qa_users);

UPDATE public.usuarios u
   SET estado = 'INACTIVO',
       email = 'baja-' || u.id || '@anonimo.invalid',
       nombre_completo = 'Cuenta de prueba QA (anonimizada)',
       -- Un hash bcrypt imposible: ningún login puede coincidir.
       password_hash = '!anonimizada',
       updated_at = now()
 WHERE u.id IN (SELECT id FROM qa_users)
   AND (u.estado <> 'INACTIVO' OR u.email NOT LIKE 'baja-%@anonimo.invalid')
RETURNING u.id;

COMMIT;
