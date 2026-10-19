import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from '../media/media-storage.port';
import { RoutineNotifier } from '../training/routine-notifier';
import { CommentRow, CommunityRepository } from './community.repository';
import { env } from '../../config/env';
import { CommentInput, CommentListQuery, ContentKind } from './community.schemas';

const COMMENTS_PER_MINUTE = 10;
const NOTIFY_WINDOW_MS = 15 * 60 * 1000;

type Actor = { id: string };

export type UploadedCommentFile = { buffer: Buffer; size: number; mimetype: string; originalname: string };

const FILE_MIMES = ['application/pdf', 'text/plain', 'application/zip'];

function attachmentKindOf(mime: string): 'IMAGEN' | 'VIDEO' | 'ARCHIVO' | null {
  if (mime.startsWith('image/')) return 'IMAGEN';
  if (mime.startsWith('video/')) return 'VIDEO';
  return FILE_MIMES.includes(mime) ? 'ARCHIVO' : null;
}

export type CommentResponse = {
  id: string;
  autor: { id: string; nombre: string; fotoUrl: string | null };
  texto: string;
  adjunto: {
    tipo: string;
    url: string;
    mime: string | null;
    nombre: string | null;
    bytes: number | null;
    ancho: number | null;
    alto: number | null;
  } | null;
  respuestaA: string | null;
  creadoEn: Date;
  esMio: boolean;
  likes: number;
  meGusta: boolean;
  respuestas: CommentResponse[];
};

/**
 * Valoraciones (1–5) y comentarios de rutinas y ejercicios (RF-11, RF-12).
 * Los comentarios de un ejercicio del catálogo (consejos, técnica, dudas) usan
 * esta misma tabla con `target_kind = 'EXERCISE'`: misma moderación, mismas
 * denuncias (`COMMENT`), mismos «me gusta» (= «útil») y respuestas de un nivel.
 */
@Injectable()
export class CommunityService {
  constructor(
    private readonly repository: CommunityRepository,
    private readonly notifier: RoutineNotifier,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly mediaStorage: MediaStorageProvider,
  ) {}

  /** Sube la foto, video o archivo que irá en un comentario y devuelve el adjunto listo para enviar. */
  async uploadAttachment(actor: Actor, file: UploadedCommentFile | undefined) {
    if (!file || !file.buffer || file.size === 0) throw new BadRequestException('Se requiere un archivo no vacío.');
    const mime = file.mimetype.toLowerCase();
    if (file.size > env.CHAT_MEDIA_MAX_BYTES) throw new BadRequestException('El archivo es demasiado grande.');
    const kind = attachmentKindOf(mime);
    if (!kind || (kind !== 'ARCHIVO' && !env.CHAT_MEDIA_ALLOWED_MIME.includes(mime))) {
      throw new BadRequestException('Tipo de archivo no admitido.');
    }
    const stored = await this.mediaStorage.upload(
      { originalName: file.originalname, mimeType: mime, sizeBytes: file.size, buffer: file.buffer },
      { category: 'publicaciones', ownerUserId: actor.id },
    );
    return { tipo: kind, url: stored.url, mime, nombre: file.originalname.slice(0, 200), bytes: stored.sizeBytes };
  }

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
    const order = query.orden ?? 'recientes';
    const [top, total] = await Promise.all([
      this.repository.listTopLevel(kind, id, actor.id, query.limit + 1, offset, order),
      this.repository.countVisible(kind, id, actor.id),
    ]);
    const page = top.slice(0, query.limit);
    const replies = await this.repository.listReplies(page.map((c) => c.id), actor.id);
    return {
      items: page.map((row) =>
        this.toResponse(row, actor.id, replies.filter((r) => r.replyToId === row.id)),
      ),
      siguienteCursor: top.length > query.limit ? encode(offset + query.limit) : null,
      total,
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
    if (input.attachment && !isTrustedAttachmentUrl(input.attachment, actor.id)) {
      throw new BadRequestException('El adjunto no es válido.');
    }
    if (input.replyToId) {
      const parent = await this.repository.findComment(input.replyToId);
      // Un solo nivel de respuestas, y solo al comentario de este mismo contenido.
      // Tampoco a uno oculto o borrado, ni al de alguien con quien hay un bloqueo:
      // ese comentario no se ve, así que responderlo sería escribir a ciegas.
      if (
        !parent ||
        parent.targetId !== id ||
        parent.targetKind !== kind ||
        parent.replyToId ||
        parent.status !== 'VISIBLE' ||
        (await this.repository.isBlockedBetween(actor.id, parent.authorId))
      ) {
        throw new BadRequestException('Solo se puede responder a un comentario de este contenido.');
      }
    }
    const comment = await this.repository.createComment({
      kind,
      targetId: id,
      authorId: actor.id,
      text: input.text,
      replyToId: input.replyToId,
      attachment: input.attachment,
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
    const row = await this.repository.findVisibleCommentRow(comment.id, actor.id);
    if (!row) throw new NotFoundException('Comentario no encontrado.');
    return this.toResponse(row, actor.id, []);
  }

  /** Da (`liked`) o quita el me gusta de un comentario visible de contenido que la persona puede ver. */
  async setLike(actor: Actor, commentId: string, liked: boolean) {
    const comment = await this.repository.findComment(commentId);
    if (!comment || comment.status !== 'VISIBLE') throw new NotFoundException('Comentario no encontrado.');
    await this.visibleTargetOrFail(comment.targetKind, comment.targetId, actor.id);
    if (await this.repository.isBlockedBetween(actor.id, comment.authorId)) {
      throw new NotFoundException('Comentario no encontrado.');
    }
    return { likes: await this.repository.setCommentLike(commentId, actor.id, liked), meGusta: liked };
  }

  /** El autor borra el suyo: queda como BORRADO_AUTOR y sin texto. */
  async remove(actor: Actor, commentId: string) {
    const comment = await this.repository.findComment(commentId);
    if (!comment || comment.authorId !== actor.id) throw new NotFoundException('Comentario no encontrado.');
    await comment.update({
      status: 'BORRADO_AUTOR',
      text: '',
      attachmentKind: null,
      attachmentUrl: null,
      attachmentMime: null,
      attachmentName: null,
      attachmentBytes: null,
      attachmentWidth: null,
      attachmentHeight: null,
    });
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
      autor: { id: row.authorId, nombre: row.authorName, fotoUrl: row.authorPhotoUrl },
      texto: row.text,
      adjunto:
        row.attachmentKind && row.attachmentUrl
          ? {
              tipo: row.attachmentKind,
              url: row.attachmentUrl,
              mime: row.attachmentMime,
              nombre: row.attachmentName,
              bytes: row.attachmentBytes,
              ancho: row.attachmentWidth,
              alto: row.attachmentHeight,
            }
          : null,
      respuestaA: row.replyToId,
      creadoEn: row.createdAt,
      esMio: row.authorId === viewerId,
      likes: row.likes,
      meGusta: row.likedByViewer,
      respuestas: replies.map((r) => this.toResponse(r, viewerId, [])),
    };
  }
}

/**
 * Un adjunto solo se acepta si su URL es de GIPHY (GIF y sticker) o de la carpeta
 * de publicaciones de quien comenta: así nadie cuelga una dirección arbitraria.
 */
function isTrustedAttachmentUrl(attachment: { tipo: string; url: string }, userId: string): boolean {
  if (attachment.tipo === 'GIF' || attachment.tipo === 'STICKER') {
    try {
      const url = new URL(attachment.url);
      return url.protocol === 'https:' && (url.hostname === 'giphy.com' || url.hostname.endsWith('.giphy.com'));
    } catch {
      return false;
    }
  }
  const base = env.MEDIA_STORAGE_PUBLIC_BASE_URL.replace(/\/+$/, '');
  return attachment.url.startsWith(`${base}/users/${userId}/publicaciones/`);
}

const encode = (offset: number): string => Buffer.from(String(offset), 'utf8').toString('base64url');
const decode = (cursor?: string): number => {
  const n = cursor ? Number(Buffer.from(cursor, 'base64url').toString('utf8')) : 0;
  return Number.isInteger(n) && n >= 0 ? n : 0;
};
