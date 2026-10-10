import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes, Transaction } from 'sequelize';
import { exerciseVisibleSql, routineVisibleSql } from '../../common/sql/content-visibility';
import { ContentCommentModel } from './content-comment.model';
import { ContentRatingModel } from './content-rating.model';
import { ContentKind } from './community.schemas';

export type TargetInfo = { ownerId: string | null; title: string };

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
    return { promedio: row?.promedio == null ? null : Number(row.promedio), total: row?.total ?? 0 };
  }

  async findMyRating(kind: ContentKind, id: string, userId: string): Promise<number | null> {
    return (await this.ratings.findOne({ where: { targetKind: kind, targetId: id, userId } }))?.stars ?? null;
  }

  async summary(kind: ContentKind, id: string) {
    const [row] = await this.ratings.sequelize!.query<{ promedio: string | null; total: number }>(
      `SELECT valoracion_promedio AS promedio, valoracion_total AS total FROM ${TABLE[kind]} WHERE id = :id`,
      { type: QueryTypes.SELECT, replacements: { id } },
    );
    return { promedio: row?.promedio == null ? null : Number(row.promedio), total: row?.total ?? 0 };
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
  }) {
    return this.comments.create({
      targetKind: input.kind,
      targetId: input.targetId,
      authorId: input.authorId,
      text: input.text,
      replyToId: input.replyToId,
    });
  }

  findComment(id: string) {
    return this.comments.findByPk(id);
  }

  /** Comentarios de primer nivel visibles (más nuevos primero) con su autor. */
  async listTopLevel(kind: ContentKind, id: string, limitPlusOne: number, offset: number) {
    return this.listRows(
      `c.target_kind = :kind AND c.target_id = :id AND c.respuesta_a IS NULL AND c.estado = 'VISIBLE'`,
      { kind, id, limitPlusOne, offset },
      'ORDER BY c.created_at DESC, c.id LIMIT :limitPlusOne OFFSET :offset',
    );
  }

  listReplies(parentIds: readonly string[]) {
    if (parentIds.length === 0) return Promise.resolve([]);
    return this.listRows(
      `c.respuesta_a IN (:parentIds) AND c.estado = 'VISIBLE'`,
      { parentIds: [...parentIds] },
      'ORDER BY c.created_at ASC, c.id',
    );
  }

  private listRows(where: string, replacements: Record<string, unknown>, tail: string) {
    return this.comments.sequelize!.query<CommentRow>(
      `SELECT c.id, c.autor_id AS "authorId", u.nombre_completo AS "authorName", c.texto AS text,
              c.respuesta_a AS "replyToId", c.created_at AS "createdAt"
         FROM community.content_comments c JOIN public.usuarios u ON u.id = c.autor_id
        WHERE ${where} ${tail}`,
      { type: QueryTypes.SELECT, replacements },
    );
  }
}

export type CommentRow = {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  replyToId: string | null;
  createdAt: Date;
};
