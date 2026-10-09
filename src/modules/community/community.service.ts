import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { RoutineNotifier } from '../training/routine-notifier';
import { CommentRow, CommunityRepository } from './community.repository';
import { CommentInput, CommentListQuery, ContentKind } from './community.schemas';

const COMMENTS_PER_MINUTE = 10;
const NOTIFY_WINDOW_MS = 15 * 60 * 1000;

type Actor = { id: string };

export type CommentResponse = {
  id: string;
  autor: { id: string; nombre: string };
  texto: string;
  respuestaA: string | null;
  creadoEn: Date;
  esMio: boolean;
  respuestas: CommentResponse[];
};

/** Valoraciones (1–5) y comentarios de rutinas y ejercicios privados (RF-11, RF-12). */
@Injectable()
export class CommunityService {
  constructor(
    private readonly repository: CommunityRepository,
    private readonly notifier: RoutineNotifier,
  ) {}

  async summary(actor: Actor, kind: ContentKind, id: string) {
    await this.visibleTargetOrFail(kind, id, actor.id);
    return {
      ...(await this.repository.summary(kind, id)),
      miValoracion: await this.repository.findMyRating(kind, id, actor.id),
    };
  }

  async rate(actor: Actor, kind: ContentKind, id: string, stars: number) {
    const target = await this.visibleTargetOrFail(kind, id, actor.id);
    if (target.ownerId === actor.id) {
      throw new DomainException(400, 'CANNOT_RATE_OWN', 'No puedes valorar tu propio contenido.');
    }
    const summary = await this.repository.upsertRating(kind, id, actor.id, stars);
    return { ...summary, miValoracion: stars };
  }

  async removeRating(actor: Actor, kind: ContentKind, id: string) {
    await this.visibleTargetOrFail(kind, id, actor.id);
    return { ...(await this.repository.deleteRating(kind, id, actor.id)), miValoracion: null };
  }

  async list(actor: Actor, kind: ContentKind, id: string, query: CommentListQuery) {
    await this.visibleTargetOrFail(kind, id, actor.id);
    const offset = decode(query.cursor);
    const top = await this.repository.listTopLevel(kind, id, query.limit + 1, offset);
    const page = top.slice(0, query.limit);
    const replies = await this.repository.listReplies(page.map((c) => c.id));
    return {
      items: page.map((row) =>
        this.toResponse(row, actor.id, replies.filter((r) => r.replyToId === row.id)),
      ),
      siguienteCursor: top.length > query.limit ? encode(offset + query.limit) : null,
    };
  }

  async create(actor: Actor, kind: ContentKind, id: string, input: CommentInput) {
    const target = await this.visibleTargetOrFail(kind, id, actor.id);
    if ((await this.repository.countRecentComments(actor.id, 60_000)) >= COMMENTS_PER_MINUTE) {
      throw new HttpException(
        'Estás comentando demasiado rápido. Espera un momento.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (input.replyToId) {
      const parent = await this.repository.findComment(input.replyToId);
      // Un solo nivel de respuestas, y solo al comentario de este mismo contenido.
      if (!parent || parent.targetId !== id || parent.targetKind !== kind || parent.replyToId) {
        throw new BadRequestException('Solo se puede responder a un comentario de este contenido.');
      }
    }
    const comment = await this.repository.createComment({
      kind,
      targetId: id,
      authorId: actor.id,
      text: input.text,
      replyToId: input.replyToId,
    });
    if (kind === 'ROUTINE' && target.ownerId && target.ownerId !== actor.id) {
      await this.notifier.notify({
        to: target.ownerId,
        type: 'ROUTINE_COMMENT',
        subject: 'Nuevo comentario',
        body: `Hay comentarios nuevos en "${target.title}"`,
        // Agrupa: como mucho un aviso cada 15 minutos por rutina.
        dedupeKey: `${id}:${Math.floor(Date.now() / NOTIFY_WINDOW_MS)}`,
        refs: { routineId: id, commentId: comment.id },
      });
    }
    return this.toResponse(
      { id: comment.id, authorId: actor.id, authorName: '', text: comment.text, replyToId: comment.replyToId, createdAt: comment.createdAt },
      actor.id,
      [],
    );
  }

  /** El autor borra el suyo: queda como BORRADO_AUTOR y sin texto. */
  async remove(actor: Actor, commentId: string) {
    const comment = await this.repository.findComment(commentId);
    if (!comment || comment.authorId !== actor.id) throw new NotFoundException('Comentario no encontrado.');
    await comment.update({ status: 'BORRADO_AUTOR', text: '' });
    return { deleted: true };
  }

  private async visibleTargetOrFail(kind: ContentKind, id: string, userId: string) {
    const target = await this.repository.findVisibleTarget(kind, id, userId);
    if (!target) throw new NotFoundException('Contenido no encontrado.');
    return target;
  }

  private toResponse(row: CommentRow, viewerId: string, replies: CommentRow[]): CommentResponse {
    return {
      id: row.id,
      autor: { id: row.authorId, nombre: row.authorName },
      texto: row.text,
      respuestaA: row.replyToId,
      creadoEn: row.createdAt,
      esMio: row.authorId === viewerId,
      respuestas: replies.map((r) => this.toResponse(r, viewerId, [])),
    };
  }
}

const encode = (offset: number): string => Buffer.from(String(offset), 'utf8').toString('base64url');
const decode = (cursor?: string): number => {
  const n = cursor ? Number(Buffer.from(cursor, 'base64url').toString('utf8')) : 0;
  return Number.isInteger(n) && n >= 0 ? n : 0;
};
