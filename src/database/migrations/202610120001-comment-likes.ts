import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

/**
 * Me gusta de comentarios (rutinas y ejercicios). Misma forma que
 * `community.exercise_likes`: una fila por persona y comentario, sin contador
 * desnormalizado (se cuenta en la misma consulta que lista los comentarios).
 * La clave primaria empieza por `comentario_id`, así que ya sirve de índice
 * para contar por comentario. Borrar el comentario o la cuenta se lleva sus
 * me gusta (ON DELETE CASCADE).
 */
const upStatements = [
  `CREATE TABLE community.comment_likes (
     comentario_id uuid NOT NULL REFERENCES community.content_comments(id) ON DELETE CASCADE,
     usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (comentario_id, usuario_id)
   )`,
  `CREATE INDEX ix_comment_likes_usuario ON community.comment_likes(usuario_id, created_at DESC)`,
] as const;

const downStatements = [`DROP TABLE IF EXISTS community.comment_likes`] as const;

export const commentLikesMigration: DatabaseMigration = {
  id: '202610120001-comment-likes',
  description: 'Likes on community comments.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
