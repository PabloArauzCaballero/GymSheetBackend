import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes, Transaction } from 'sequelize';
import { exerciseVisibleSql, routineVisibleSql } from '../../common/sql/content-visibility';
import { authorPhotoSql } from '../training/routine-catalog.repository';
import { ContentCommentModel } from './content-comment.model';
import { ContentRatingModel } from './content-rating.model';
import { AttachmentInput, CommentOrder, ContentKind } from './community.schemas';

export type TargetInfo = { ownerId: string | null; title: string };

/** Cuántas valoraciones hay de cada nota; siempre trae las cinco claves. */
export type RatingDistribution = Record<'1' | '2' | '3' | '4' | '5', number>;

/**
 * El bloqueo es mutuo: ni veo lo que escribe quien bloqueé, ni quien me bloqueó
 * ve lo mío. `author` es una expresión SQL de columna; el lector va enlazado.
 */
const notBlockedSql = (author: string): string => `NOT EXISTS (
  SELECT 1 FROM social.user_blocks b
   WHERE (b.blocker_id = :viewerId AND b.blocked_id = ${author})
      OR (b.blocker_id = ${author} AND b.blocked_id = :viewerId))`;

const ORDER_BY: Record<CommentOrder, string> = {
  recientes: 'ORDER BY c.created_at DESC, c.id',
  utiles: 'ORDER BY likes DESC, c.created_at DESC, c.id',
};

const TABLE: Record<ContentKind, string> = {
  ROUTINE: 'training.routines',
  EXERCISE: 'public.ejercicios',
};

@Injectable()
export class CommunityRepository {
  constructor(
    @InjectModel(ContentRatingModel) private readonly ratings: typeof ContentRatingModel,
    @InjectModel(ContentCommentModel) private readonly comments: typeof ContentCommentModel,
  ) {}

  /** Quien lo ve, o `null` si no existe / no es visible para esa persona (→ 404). */
  async findVisibleTarget(kind: ContentKind, id: string, userId: string): Promise<TargetInfo | null> {
    const sql =
      kind === 'ROUTINE'
        ? `SELECT r.created_by_user_id AS "ownerId", r.nombre AS title FROM training.routines r
            WHERE r.id = :id AND r.estado_moderacion = 'VISIBLE' AND ${routineVisibleSql('r', ':userId')}`
        : `SELECT e.created_by_usuario_id AS "ownerId", e.nombre AS title FROM public.ejercicios e
            WHERE e.id = :id AND e.estado_moderacion = 'VISIBLE' AND ${exerciseVisibleSql('e', ':userId')}`;
    const rows = await this.ratings.sequelize!.query<TargetInfo>(sql, {
      type: QueryTypes.SELECT,
      replacements: { id, userId },
    });
    return rows[0] ?? null;
  }

  /** Guarda la valoración y recalcula el promedio en la MISMA transacción. */
  async upsertRating(kind: ContentKind, id: string, userId: string, stars: number) {
    return this.ratings.sequelize!.transaction(async (transaction) => {
      await this.ratings.upsert({ targetKind: kind, targetId: id, userId, stars }, { transaction });
      return this.recompute(kind, id, transaction);
    });
  }

  async deleteRating(kind: ContentKind, id: string, userId: string) {
    return this.ratings.sequelize!.transaction(async (transaction) => {
      await this.ratings.destroy({ where: { targetKind: kind, targetId: id, userId }, transaction });
      return this.recompute(kind, id, transaction);
    });
  }

  private async recompute(kind: ContentKind, id: string, transaction: Transaction) {
    const [row] = await this.ratings.sequelize!.query<{ promedio: string | null; total: number }>(
      `UPDATE ${TABLE[kind]} t
          SET valoracion_total = s.total, valoracion_promedio = s.promedio
         FROM (SELECT count(*)::int AS total, round(avg(estrellas)::numeric, 2) AS promedio
                 FROM community.content_ratings WHERE target_kind = :kind AND target_id = :id) s
        WHERE t.id = :id
        RETURNING t.valoracion_promedio AS promedio, t.valoracion_total AS total`,
      { type: QueryTypes.SELECT, replacements: { kind, id }, transaction },
    );
    return {
      promedio: row?.promedio == null ? null : Number(row.promedio),
      total: row?.total ?? 0,
      distribucion: await this.distribution(kind, id, transaction),
    };
  }

  private async distribution(kind: ContentKind, id: string, transaction?: Transaction): Promise<RatingDistribution> {
    const rows = await this.ratings.sequelize!.query<{ estrellas: number; total: number }>(
      `SELECT estrellas, count(*)::int AS total FROM community.content_ratings
        WHERE target_kind = :kind AND target_id = :id GROUP BY estrellas`,
      { type: QueryTypes.SELECT, replacements: { kind, id }, transaction },
    );
    const distribucion: RatingDistribution = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 };
    for (const row of rows) distribucion[String(row.estrellas) as keyof RatingDistribution] = row.total;
    return distribucion;
  }

  async findMyRating(kind: ContentKind, id: string, userId: string): Promise<number | null> {
    return (await this.ratings.findOne({ where: { targetKind: kind, targetId: id, userId } }))?.stars ?? null;
  }

  async summary(kind: ContentKind, id: string) {
    const [row] = await this.ratings.sequelize!.query<{ promedio: string | null; total: number }>(
      `SELECT valoracion_promedio AS promedio, valoracion_total AS total FROM ${TABLE[kind]} WHERE id = :id`,
      { type: QueryTypes.SELECT, replacements: { id } },
    );
    return {
      promedio: row?.promedio == null ? null : Number(row.promedio),
      total: row?.total ?? 0,
      distribucion: await this.distribution(kind, id),
    };
  }

  countRecentComments(authorId: string, sinceMs: number): Promise<number> {
    return this.comments.count({
      where: { authorId, createdAt: { [Op.gt]: new Date(Date.now() - sinceMs) } },
    });
  }

  createComment(input: {
    kind: ContentKind;
    targetId: string;
    authorId: string;
    text: string;
    replyToId: string | null;
    attachment?: AttachmentInput | null;
  }) {
    return this.comments.create({
      targetKind: input.kind,
      targetId: input.targetId,
      authorId: input.authorId,
      text: input.text,
      replyToId: input.replyToId,
      attachmentKind: input.attachment?.tipo ?? null,
      attachmentUrl: input.attachment?.url ?? null,
      attachmentMime: input.attachment?.mime ?? null,
      attachmentName: input.attachment?.nombre ?? null,
      attachmentBytes: input.attachment?.bytes ?? null,
      attachmentWidth: input.attachment?.ancho ?? null,
      attachmentHeight: input.attachment?.alto ?? null,
    });
  }

  findComment(id: string) {
    return this.comments.findByPk(id);
  }

  /** Comentarios de primer nivel visibles (en el `order` pedido) con su autor y sus me gusta. */
  async listTopLevel(
    kind: ContentKind,
    id: string,
    viewerId: string,
    limitPlusOne: number,
    offset: number,
    order: CommentOrder = 'recientes',
  ) {
    return this.listRows(
      `c.target_kind = :kind AND c.target_id = :id AND c.respuesta_a IS NULL AND c.estado = 'VISIBLE'`,
      { kind, id, viewerId, limitPlusOne, offset },
      `${ORDER_BY[order]} LIMIT :limitPlusOne OFFSET :offset`,
    );
  }

  /**
   * Cuántos comentarios ve esta persona en el contenido: los de primer nivel y
   * las respuestas cuyo hilo sigue a la vista, sin los de autores bloqueados.
   * Es el contador de la ficha; cuadra con lo que la lista puede llegar a enseñar.
   */
  async countVisible(kind: ContentKind, id: string, viewerId: string): Promise<number> {
    const [row] = await this.comments.sequelize!.query<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM community.content_comments c
         LEFT JOIN community.content_comments p ON p.id = c.respuesta_a
        WHERE c.target_kind = :kind AND c.target_id = :id AND c.estado = 'VISIBLE'
          AND ${notBlockedSql('c.autor_id')}
          AND (c.respuesta_a IS NULL OR (p.estado = 'VISIBLE' AND ${notBlockedSql('p.autor_id')}))`,
      { type: QueryTypes.SELECT, replacements: { kind, id, viewerId } },
    );
    return row?.total ?? 0;
  }

  /** ¿Hay un bloqueo, en cualquier sentido, entre estas dos personas? */
  async isBlockedBetween(viewerId: string, otherId: string): Promise<boolean> {
    const rows = await this.comments.sequelize!.query<{ blocked: boolean }>(
      `SELECT NOT ${notBlockedSql(':otherId')} AS blocked`,
      { type: QueryTypes.SELECT, replacements: { viewerId, otherId } },
    );
    return rows[0]?.blocked === true;
  }

  listReplies(parentIds: readonly string[], viewerId: string) {
    if (parentIds.length === 0) return Promise.resolve([]);
    return this.listRows(
      `c.respuesta_a IN (:parentIds) AND c.estado = 'VISIBLE'`,
      { parentIds: [...parentIds], viewerId },
      'ORDER BY c.created_at ASC, c.id',
    );
  }

  /** Un comentario visible con la misma forma que la lista, o `null`. */
  async findVisibleCommentRow(commentId: string, viewerId: string): Promise<CommentRow | null> {
    const rows = await this.listRows(`c.id = :commentId AND c.estado = 'VISIBLE'`, { commentId, viewerId }, '');
    return rows[0] ?? null;
  }

  /** Da o quita el me gusta (idempotente) y devuelve el total resultante. */
  async setCommentLike(commentId: string, userId: string, liked: boolean): Promise<number> {
    const sequelize = this.comments.sequelize!;
    await sequelize.query(
      liked
        ? `INSERT INTO community.comment_likes (comentario_id, usuario_id) VALUES (:commentId, :userId)
           ON CONFLICT (comentario_id, usuario_id) DO NOTHING`
        : `DELETE FROM community.comment_likes WHERE comentario_id = :commentId AND usuario_id = :userId`,
      { replacements: { commentId, userId } },
    );
    const [row] = await sequelize.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM community.comment_likes WHERE comentario_id = :commentId`,
      { type: QueryTypes.SELECT, replacements: { commentId } },
    );
    return row?.total ?? 0;
  }

  // Los me gusta y la foto salen en la MISMA consulta que la página: nada de una consulta por comentario.
  private listRows(where: string, replacements: Record<string, unknown>, tail: string) {
    return this.comments.sequelize!.query<CommentRow>(
      `SELECT c.id, c.autor_id AS "authorId", u.nombre_completo AS "authorName",
              ${authorPhotoSql('c.autor_id')} AS "authorPhotoUrl", c.texto AS text,
              c.respuesta_a AS "replyToId", c.created_at AS "createdAt",
              c.adjunto_tipo AS "attachmentKind", c.adjunto_url AS "attachmentUrl",
              c.adjunto_mime AS "attachmentMime", c.adjunto_nombre AS "attachmentName",
              c.adjunto_bytes AS "attachmentBytes", c.adjunto_ancho AS "attachmentWidth",
              c.adjunto_alto AS "attachmentHeight",
              (SELECT count(*)::int FROM community.comment_likes l WHERE l.comentario_id = c.id) AS likes,
              EXISTS (SELECT 1 FROM community.comment_likes l
                       WHERE l.comentario_id = c.id AND l.usuario_id = :viewerId) AS "likedByViewer"
         FROM community.content_comments c JOIN public.usuarios u ON u.id = c.autor_id
        WHERE ${where} AND ${notBlockedSql('c.autor_id')} ${tail}`,
      { type: QueryTypes.SELECT, replacements },
    );
  }
}

export type CommentRow = {
  id: string;
  authorId: string;
  authorName: string;
  authorPhotoUrl: string | null;
  text: string;
  replyToId: string | null;
  createdAt: Date;
  likes: number;
  likedByViewer: boolean;
  attachmentKind: string | null;
  attachmentUrl: string | null;
  attachmentMime: string | null;
  attachmentName: string | null;
  attachmentBytes: number | null;
  attachmentWidth: number | null;
  attachmentHeight: number | null;
};
