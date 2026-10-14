import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

/**
 * Adjuntos de comentarios: un GIF, sticker, foto, video o archivo por comentario.
 * Las columnas son nulas en los comentarios de solo texto (todos los de antes).
 */
const upStatements = [
  `ALTER TABLE community.content_comments
     ADD COLUMN adjunto_tipo varchar(10),
     ADD COLUMN adjunto_url text,
     ADD COLUMN adjunto_mime varchar(100),
     ADD COLUMN adjunto_nombre varchar(200),
     ADD COLUMN adjunto_bytes integer,
     ADD COLUMN adjunto_ancho integer,
     ADD COLUMN adjunto_alto integer`,
] as const;

const downStatements = [
  `ALTER TABLE community.content_comments
     DROP COLUMN IF EXISTS adjunto_tipo, DROP COLUMN IF EXISTS adjunto_url,
     DROP COLUMN IF EXISTS adjunto_mime, DROP COLUMN IF EXISTS adjunto_nombre,
     DROP COLUMN IF EXISTS adjunto_bytes, DROP COLUMN IF EXISTS adjunto_ancho,
     DROP COLUMN IF EXISTS adjunto_alto`,
] as const;

export const commentMediaMigration: DatabaseMigration = {
  id: '202610140001-comment-media',
  description: 'Media attachments (GIF, sticker, image, video, file) on community comments.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
