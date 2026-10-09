import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

/**
 * Comunidad (RF-11, RF-12): valoraciones y comentarios de rutinas y ejercicios,
 * me gusta de ejercicios y estado de moderación del ejercicio.
 * Los contadores se mantienen en la misma transacción que la escritura.
 */
const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS community`,
  `CREATE TABLE community.content_ratings (
     target_kind varchar(12) NOT NULL,
     target_id uuid NOT NULL,
     usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     estrellas smallint NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (target_kind, target_id, usuario_id),
     CONSTRAINT ck_content_rating_kind CHECK (target_kind IN ('ROUTINE','EXERCISE')),
     CONSTRAINT ck_content_rating_stars CHECK (estrellas BETWEEN 1 AND 5)
   )`,
  `CREATE TABLE community.content_comments (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     target_kind varchar(12) NOT NULL,
     target_id uuid NOT NULL,
     autor_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     respuesta_a uuid REFERENCES community.content_comments(id) ON DELETE CASCADE,
     texto varchar(1000) NOT NULL,
     estado varchar(20) NOT NULL DEFAULT 'VISIBLE',
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_content_comment_kind CHECK (target_kind IN ('ROUTINE','EXERCISE')),
     CONSTRAINT ck_content_comment_estado CHECK (estado IN ('VISIBLE','OCULTO_AUTO','OCULTO_MODERACION','BORRADO_AUTOR'))
   )`,
  `CREATE INDEX ix_content_comments_target ON community.content_comments(target_kind, target_id, created_at DESC)`,
  `CREATE INDEX ix_content_comments_autor ON community.content_comments(autor_id, created_at DESC)`,
  `CREATE TABLE community.exercise_likes (
     ejercicio_id uuid NOT NULL REFERENCES public.ejercicios(id) ON DELETE CASCADE,
     usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (ejercicio_id, usuario_id)
   )`,
  `CREATE INDEX ix_exercise_likes_usuario ON community.exercise_likes(usuario_id, created_at DESC)`,
  `ALTER TABLE public.ejercicios
     ADD COLUMN IF NOT EXISTS me_gusta_total integer NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS estado_moderacion varchar(20) NOT NULL DEFAULT 'VISIBLE',
     ADD COLUMN IF NOT EXISTS valoracion_promedio numeric(3,2),
     ADD COLUMN IF NOT EXISTS valoracion_total integer NOT NULL DEFAULT 0`,
  `ALTER TABLE public.ejercicios ADD CONSTRAINT ck_ejercicio_moderacion
     CHECK (estado_moderacion IN ('VISIBLE','OCULTO_AUTO','OCULTO_MODERACION'))`,
] as const;

const downStatements = [
  `ALTER TABLE public.ejercicios DROP CONSTRAINT IF EXISTS ck_ejercicio_moderacion`,
  `ALTER TABLE public.ejercicios
     DROP COLUMN IF EXISTS valoracion_total, DROP COLUMN IF EXISTS valoracion_promedio,
     DROP COLUMN IF EXISTS estado_moderacion, DROP COLUMN IF EXISTS me_gusta_total`,
  `DROP TABLE IF EXISTS community.exercise_likes`,
  `DROP TABLE IF EXISTS community.content_comments`,
  `DROP TABLE IF EXISTS community.content_ratings`,
] as const;

export const communityMigration: DatabaseMigration = {
  id: '202610080003-community',
  description: 'Ratings, comments and likes for routines and exercises, with exercise moderation state.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
