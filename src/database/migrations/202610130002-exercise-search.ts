import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

/**
 * Búsqueda de ejercicios tolerante a erratas y sin acentos.
 *
 * - `pg_trgm` y `unaccent` son extensiones «trusted» desde PostgreSQL 13: las
 *   crea el dueño de la base sin ser superusuario. Van en `public`, como
 *   `uuid-ossp`.
 * - `repp_normalize(text)`: minúsculas, sin acentos, solo letras y números
 *   separados por un espacio. Es IMMUTABLE (envuelve `unaccent` con su
 *   diccionario explícito) para poder indexarla; el mismo criterio vive en
 *   `exercise-search.ts` para normalizar lo que teclea la persona.
 * - `ejercicios.busqueda`: nombre en español, nombre original y alias, ya
 *   normalizados. `busqueda_extra`: músculo, zona y equipo. Los mantiene un
 *   disparador, así que ningún camino de escritura (importador, sembrador,
 *   backoffice, ejercicio propio) puede dejarlos desfasados.
 * - `alias_busqueda`: nombres por los que también debe encontrarse un ejercicio
 *   sin que se muestren (el borrador en español todavía sin revisar).
 * - Índices GIN de trigramas sobre ambas columnas.
 */
const upStatements = [
  `CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public`,
  `CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public`,
  `CREATE OR REPLACE FUNCTION public.repp_normalize(input text) RETURNS text
     LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
       SELECT btrim(regexp_replace(
         lower(public.unaccent('public.unaccent'::regdictionary, input)),
         '[^a-z0-9]+', ' ', 'g'))
     $$`,
  `ALTER TABLE public.ejercicios
     ADD COLUMN alias_busqueda text,
     ADD COLUMN busqueda text NOT NULL DEFAULT '',
     ADD COLUMN busqueda_extra text NOT NULL DEFAULT ''`,
  `CREATE OR REPLACE FUNCTION public.ejercicios_busqueda_refresh() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       NEW.busqueda := public.repp_normalize(
         concat_ws(' ', NEW.nombre_es, NEW.nombre, NEW.alias_busqueda));
       NEW.busqueda_extra := public.repp_normalize(
         concat_ws(' ', NEW.target_muscle, NEW.grupo_muscular, NEW.body_part,
                   NEW.required_equipment, NEW.category));
       RETURN NEW;
     END $$`,
  `CREATE TRIGGER trg_ejercicios_busqueda
     BEFORE INSERT OR UPDATE ON public.ejercicios
     FOR EACH ROW EXECUTE FUNCTION public.ejercicios_busqueda_refresh()`,
  // Rellena las filas existentes pasando por el disparador.
  `UPDATE public.ejercicios SET alias_busqueda = alias_busqueda`,
  `CREATE INDEX ix_ejercicios_busqueda_trgm
     ON public.ejercicios USING gin (busqueda public.gin_trgm_ops)`,
  `CREATE INDEX ix_ejercicios_busqueda_extra_trgm
     ON public.ejercicios USING gin (busqueda_extra public.gin_trgm_ops)`,
] as const;

// Las extensiones no se quitan: otra cosa podría estar usándolas ya.
const downStatements = [
  `DROP INDEX IF EXISTS public.ix_ejercicios_busqueda_extra_trgm`,
  `DROP INDEX IF EXISTS public.ix_ejercicios_busqueda_trgm`,
  `DROP TRIGGER IF EXISTS trg_ejercicios_busqueda ON public.ejercicios`,
  `DROP FUNCTION IF EXISTS public.ejercicios_busqueda_refresh()`,
  `ALTER TABLE public.ejercicios
     DROP COLUMN IF EXISTS busqueda_extra,
     DROP COLUMN IF EXISTS busqueda,
     DROP COLUMN IF EXISTS alias_busqueda`,
  `DROP FUNCTION IF EXISTS public.repp_normalize(text)`,
] as const;

export const exerciseSearchMigration: DatabaseMigration = {
  id: '202610130002-exercise-search',
  description: 'Typo-tolerant, accent-insensitive exercise search (pg_trgm + unaccent).',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
