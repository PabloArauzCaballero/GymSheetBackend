import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { AccessDecisionModel } from '../access-control/access-decision.model';
import { MembershipModel } from '../membership/membership.model';
import { UserRole } from '../../common/enums/domain.enums';
import {
  CategoryTreeNodeDto,
  DirectoryEntityDetailDto,
  DirectoryEntitySummaryDto,
  ReviewItemDto,
  buildCategoryTree,
  mapDirectoryEntityDetail,
  mapDirectoryEntitySummary,
  mapReviewItem,
} from './directory.mapper';
import { DirectoryRepository } from './directory.repository';
import {
  CreateEntityBody,
  CreateReviewBody,
  CreateReviewReplyBody,
  ListReviewsQuery,
  PublicDirectoryFilterQuery,
  UpdateReviewBody,
} from './directory.schemas';

@Injectable()
export class DirectoryService {
  constructor(
    private readonly repository: DirectoryRepository,
    @InjectModel(MembershipModel)
    private readonly membershipModel: typeof MembershipModel,
    @InjectModel(AccessDecisionModel)
    private readonly accessDecisionModel: typeof AccessDecisionModel
  ) {}

  // ==========================================
  // CATEGORÍAS
  // ==========================================

  async getCategoryTree(scope?: string): Promise<CategoryTreeNodeDto[]> {
    const categories = await this.repository.listActiveCategories(scope);
    return buildCategoryTree(categories);
  }

  // ==========================================
  // ENTIDADES
  // ==========================================

  async listEntities(query: PublicDirectoryFilterQuery): Promise<DirectoryEntitySummaryDto[]> {
    const entities = await this.repository.listEntities(query);
    return entities.map(mapDirectoryEntitySummary);
  }

  async getEntityBySlug(slug: string): Promise<DirectoryEntityDetailDto> {
    const entity = await this.repository.findEntityBySlug(slug);
    if (!entity || entity.status !== 'ACTIVE') {
      throw new NotFoundException('Oferente no encontrado en el directorio.');
    }
    return mapDirectoryEntityDetail(entity);
  }

  async getEntityById(id: string): Promise<DirectoryEntityDetailDto> {
    const entity = await this.repository.findEntityById(id);
    if (!entity || entity.status !== 'ACTIVE') {
      throw new NotFoundException('Oferente no encontrado en el directorio.');
    }
    return mapDirectoryEntityDetail(entity);
  }

  async createEntity(body: CreateEntityBody): Promise<DirectoryEntityDetailDto> {
    const baseSlug = body.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');

    const slug = `${baseSlug}-${Date.now().toString(36)}`;
    const entity = await this.repository.createEntity(slug, body);
    const detail = await this.repository.findEntityById(entity.id);
    return mapDirectoryEntityDetail(detail!);
  }

  // ==========================================
  // RESEÑAS ESTILO APP STORE
  // ==========================================

  async listReviews(
    entityId: string,
    query: ListReviewsQuery,
    currentUserId?: string
  ): Promise<{
    entityId: string;
    score: number;
    totalReviews: number;
    histogram: { '1': number; '2': number; '3': number; '4': number; '5': number };
    userReview: ReviewItemDto | null;
    reviews: ReviewItemDto[];
    nextCursor: string | null;
  }> {
    const entity = await this.repository.findEntityById(entityId);
    if (!entity) throw new NotFoundException('Oferente no encontrado.');

    const reviews = await this.repository.listReviewsForEntity(entityId, query);
    const reviewIds = reviews.map((r) => r.id);

    let votedSet = new Set<string>();
    let userReviewDto: ReviewItemDto | null = null;

    if (currentUserId) {
      votedSet = await this.repository.getUserHelpfulVoteIds(reviewIds, currentUserId);
      const userReview = await this.repository.findUserReviewForEntity(entityId, currentUserId);
      if (userReview) {
        userReviewDto = mapReviewItem(userReview, votedSet);
      }
    }

    const mappedReviews = reviews.map((r) => mapReviewItem(r, votedSet));

    return {
      entityId,
      score: Number(entity.ratingAverage) || 0,
      totalReviews: entity.ratingCount,
      histogram: entity.ratingBreakdown || { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
      userReview: userReviewDto,
      reviews: mappedReviews,
      nextCursor: null,
    };
  }

  async createReview(
    entityId: string,
    userId: string,
    body: CreateReviewBody
  ): Promise<ReviewItemDto> {
    const entity = await this.repository.findEntityById(entityId);
    if (!entity) throw new NotFoundException('Oferente no encontrado.');

    const existing = await this.repository.findUserReviewForEntity(entityId, userId);
    if (existing) {
      throw new ConflictException(
        'Ya has publicado una reseña para este oferente. Puedes editarla en cualquier momento.'
      );
    }

    const isVerifiedAthlete = await this.checkIfVerifiedAthlete(entity.tenantId, userId);

    const review = await this.repository.createReview(
      entityId,
      userId,
      body,
      isVerifiedAthlete
    );

    const populated = await this.repository.findReviewById(review.id);
    return mapReviewItem(populated!);
  }

  async updateReview(
    reviewId: string,
    userId: string,
    body: UpdateReviewBody
  ): Promise<ReviewItemDto> {
    const review = await this.repository.findReviewById(reviewId);
    if (!review) throw new NotFoundException('Reseña no encontrada.');
    if (review.userId !== userId) {
      throw new ForbiddenException('No tienes permiso para editar esta reseña.');
    }

    const updated = await this.repository.updateReview(reviewId, body);
    const populated = await this.repository.findReviewById(updated.id);
    return mapReviewItem(populated!);
  }

  async deleteReview(reviewId: string, userId: string, role?: UserRole): Promise<void> {
    const review = await this.repository.findReviewById(reviewId);
    if (!review) throw new NotFoundException('Reseña no encontrada.');

    const isOwner = review.userId === userId;
    const isSuperAdmin = role === UserRole.SYSTEM_ADMIN;

    if (!isOwner && !isSuperAdmin) {
      throw new ForbiddenException('No tienes permiso para eliminar esta reseña.');
    }

    await this.repository.deleteReview(reviewId);
  }

  async toggleHelpfulVote(
    reviewId: string,
    userId: string
  ): Promise<{ hasVoted: boolean; newCount: number }> {
    const review = await this.repository.findReviewById(reviewId);
    if (!review) throw new NotFoundException('Reseña no encontrada.');
    if (review.userId === userId) {
      throw new BadRequestException('No puedes marcar como útil tu propia reseña.');
    }

    return this.repository.toggleHelpfulVote(reviewId, userId);
  }

  // ==========================================
  // RESPUESTA OFICIAL DEL PROPIETARIO
  // ==========================================

  async replyToReview(
    reviewId: string,
    authorId: string,
    authorRole: UserRole,
    body: CreateReviewReplyBody
  ): Promise<ReviewItemDto> {
    const review = await this.repository.findReviewById(reviewId);
    if (!review) throw new NotFoundException('Reseña no encontrada.');

    const entity = await this.repository.findEntityById(review.entityId);
    if (!entity) throw new NotFoundException('Oferente no encontrado.');

    // Verificar si el autor es el propietario o un administrador autorizado
    const isEntityOwner = entity.userId === authorId;
    const isTenantAdmin = authorRole === UserRole.ADMIN || authorRole === UserRole.SYSTEM_ADMIN;

    if (!isEntityOwner && !isTenantAdmin) {
      throw new ForbiddenException('Solo el propietario oficial o administrador puede responder a esta reseña.');
    }

    await this.repository.createOrUpdateReply(reviewId, authorId, body.reply_text);
    const updated = await this.repository.findReviewById(reviewId);
    return mapReviewItem(updated!);
  }

  async deleteReviewReply(
    reviewId: string,
    authorId: string,
    authorRole: UserRole
  ): Promise<void> {
    const review = await this.repository.findReviewById(reviewId);
    if (!review || !review.reply) throw new NotFoundException('Respuesta no encontrada.');

    const isReplyAuthor = review.reply.authorId === authorId;
    const isSuperAdmin = authorRole === UserRole.SYSTEM_ADMIN;

    if (!isReplyAuthor && !isSuperAdmin) {
      throw new ForbiddenException('No tienes permiso para eliminar esta respuesta.');
    }

    await this.repository.deleteReply(reviewId);
  }

  // ==========================================
  // EVALUACIÓN DE ATLETA VERIFICADO
  // ==========================================

  private async checkIfVerifiedAthlete(tenantId: string | null, userId: string): Promise<boolean> {
    if (!tenantId) {
      // Para tiendas / oferentes independientes, cualquier atleta autenticado cuenta con el sello de comunidad
      return true;
    }

    // Verificar si tiene membresía o asistencias registradas en ese gimnasio/tenant
    const membership = await this.membershipModel.findOne({
      where: { tenantId, customerId: userId },
    });
    if (membership) return true;

    const access = await this.accessDecisionModel.findOne({
      where: { tenantId, customerId: userId, outcome: 'GRANTED' },
    });
    return Boolean(access);
  }
}
