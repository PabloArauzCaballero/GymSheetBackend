import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Order, QueryTypes, Transaction, WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { UserModel } from '../users/user.model';
import { CategoryModel } from './category.model';
import { DirectoryEntityCategoryModel } from './directory-entity-category.model';
import { DirectoryEntityModel } from './directory-entity.model';
import { DirectoryReviewHelpfulModel } from './directory-review-helpful.model';
import { DirectoryReviewReplyModel } from './directory-review-reply.model';
import { DirectoryReviewModel } from './directory-review.model';
import {
  CreateEntityBody,
  CreateReviewBody,
  ListReviewsQuery,
  PublicDirectoryFilterQuery,
  UpdateReviewBody,
} from './directory.schemas';

@Injectable()
export class DirectoryRepository {
  constructor(
    @InjectModel(CategoryModel)
    private readonly categoryModel: typeof CategoryModel,
    @InjectModel(DirectoryEntityModel)
    private readonly entityModel: typeof DirectoryEntityModel,
    @InjectModel(DirectoryEntityCategoryModel)
    private readonly entityCategoryModel: typeof DirectoryEntityCategoryModel,
    @InjectModel(DirectoryReviewModel)
    private readonly reviewModel: typeof DirectoryReviewModel,
    @InjectModel(DirectoryReviewReplyModel)
    private readonly reviewReplyModel: typeof DirectoryReviewReplyModel,
    @InjectModel(DirectoryReviewHelpfulModel)
    private readonly helpfulVoteModel: typeof DirectoryReviewHelpfulModel,
    private readonly sequelize: Sequelize
  ) {}

  // ==========================================
  // CATEGORÍAS
  // ==========================================

  async listActiveCategories(scope?: string): Promise<CategoryModel[]> {
    const where: WhereOptions<CategoryModel> = { isActive: true };
    if (scope && scope !== 'ALL') {
      (where as Record<symbol, unknown>)[Op.or] = [{ entityScope: scope }, { entityScope: 'ALL' }];
    }
    return this.categoryModel.findAll({
      where,
      order: [
        ['displayOrder', 'ASC'],
        ['name', 'ASC'],
      ],
    });
  }

  async findCategoryBySlug(slug: string): Promise<CategoryModel | null> {
    return this.categoryModel.findOne({ where: { slug, isActive: true } });
  }

  async findCategoryByPath(path: string): Promise<CategoryModel | null> {
    return this.categoryModel.findOne({ where: { path, isActive: true } });
  }

  // ==========================================
  // ENTIDADES
  // ==========================================

  async listEntities(query: PublicDirectoryFilterQuery): Promise<DirectoryEntityModel[]> {
    const whereConditions: Record<string | symbol, unknown> = { status: 'ACTIVE' };

    if (query.type) {
      whereConditions.entityType = query.type;
    }

    if (query.rating_min) {
      whereConditions.ratingAverage = { [Op.gte]: query.rating_min };
    }

    if (query.verified_only) {
      whereConditions.isVerified = true;
    }

    if (query.city) {
      whereConditions.city = { [Op.iLike]: `%${query.city}%` };
    }

    if (query.search) {
      whereConditions[Op.or] = [
        { name: { [Op.iLike]: `%${query.search}%` } },
        { headline: { [Op.iLike]: `%${query.search}%` } },
        { description: { [Op.iLike]: `%${query.search}%` } },
      ];
    }

    let includeCategoryWhere: WhereOptions<CategoryModel> | undefined = undefined;
    if (query.category_path) {
      includeCategoryWhere = {
        path: { [Op.like]: `${query.category_path}%` },
      };
    }

    return this.entityModel.findAll({
      where: whereConditions as WhereOptions<DirectoryEntityModel>,
      include: [
        {
          model: CategoryModel,
          as: 'primaryCategory',
          where: includeCategoryWhere,
          required: Boolean(query.category_path),
        },
      ],
      order: [
        ['isVerified', 'DESC'],
        ['ratingAverage', 'DESC'],
        ['ratingCount', 'DESC'],
        ['name', 'ASC'],
      ],
      limit: query.limit,
    });
  }

  async findEntityBySlug(slug: string): Promise<DirectoryEntityModel | null> {
    return this.entityModel.findOne({
      where: { slug },
      include: [
        { model: CategoryModel, as: 'primaryCategory' },
        { model: CategoryModel, as: 'secondaryCategories', through: { attributes: [] } },
      ],
    });
  }

  async findEntityById(id: string): Promise<DirectoryEntityModel | null> {
    return this.entityModel.findByPk(id, {
      include: [
        { model: CategoryModel, as: 'primaryCategory' },
        { model: CategoryModel, as: 'secondaryCategories', through: { attributes: [] } },
      ],
    });
  }

  async createEntity(
    slug: string,
    data: CreateEntityBody,
    transaction?: Transaction
  ): Promise<DirectoryEntityModel> {
    const entity = await this.entityModel.create(
      {
        slug,
        entityType: data.entity_type,
        name: data.name,
        headline: data.headline ?? null,
        description: data.description,
        primaryCategoryId: data.primary_category_id,
        tenantId: data.tenant_id ?? null,
        userId: data.user_id ?? null,
        branchId: data.branch_id ?? null,
        logoUrl: data.logo_url ?? null,
        coverUrl: data.cover_url ?? null,
        gallery: data.gallery ?? [],
        isOnlineOnly: data.is_online_only,
        address: data.address ?? null,
        city: data.city ?? null,
        country: data.country ?? null,
        latitude: data.latitude ? String(data.latitude) : null,
        longitude: data.longitude ? String(data.longitude) : null,
        contactInfo: data.contact_info ?? {},
        businessHours: data.business_hours ?? {},
        isVerified: data.is_verified,
        status: 'ACTIVE',
      },
      { transaction }
    );

    if (data.secondary_category_ids && data.secondary_category_ids.length > 0) {
      const records = data.secondary_category_ids.map((catId) => ({
        entityId: entity.id,
        categoryId: catId,
      }));
      await this.entityCategoryModel.bulkCreate(records, { transaction });
    }

    return entity;
  }

  // ==========================================
  // RESEÑAS
  // ==========================================

  async findReviewById(id: string): Promise<DirectoryReviewModel | null> {
    return this.reviewModel.findByPk(id, {
      include: [
        { model: UserModel, attributes: ['id', 'fullName', 'email'] },
        {
          model: DirectoryReviewReplyModel,
          include: [{ model: UserModel, attributes: ['id', 'fullName'] }],
        },
      ],
    });
  }

  async findUserReviewForEntity(
    entityId: string,
    userId: string
  ): Promise<DirectoryReviewModel | null> {
    return this.reviewModel.findOne({
      where: { entityId, userId },
      include: [
        { model: UserModel, attributes: ['id', 'fullName', 'email'] },
        {
          model: DirectoryReviewReplyModel,
          include: [{ model: UserModel, attributes: ['id', 'fullName'] }],
        },
      ],
    });
  }

  async listReviewsForEntity(
    entityId: string,
    query: ListReviewsQuery
  ): Promise<DirectoryReviewModel[]> {
    const whereConditions: Record<string, unknown> = { entityId, status: 'PUBLISHED' };
    if (query.rating) {
      whereConditions.rating = query.rating;
    }

    let order: Order = [['helpfulCount', 'DESC'], ['createdAt', 'DESC']];
    if (query.sort_by === 'recent') {
      order = [['createdAt', 'DESC']];
    } else if (query.sort_by === 'highest') {
      order = [['rating', 'DESC'], ['createdAt', 'DESC']];
    } else if (query.sort_by === 'lowest') {
      order = [['rating', 'ASC'], ['createdAt', 'DESC']];
    }

    return this.reviewModel.findAll({
      where: whereConditions as WhereOptions<DirectoryReviewModel>,
      include: [
        { model: UserModel, attributes: ['id', 'fullName', 'email'] },
        {
          model: DirectoryReviewReplyModel,
          include: [{ model: UserModel, attributes: ['id', 'fullName'] }],
        },
      ],
      order,
      limit: query.limit,
    });
  }

  async createReview(
    entityId: string,
    userId: string,
    data: CreateReviewBody,
    isVerifiedAthlete: boolean
  ): Promise<DirectoryReviewModel> {
    return this.sequelize.transaction(async (t) => {
      const review = await this.reviewModel.create(
        {
          entityId,
          userId,
          rating: data.rating,
          title: data.title,
          body: data.body,
          isVerifiedAthlete,
          experienceDate: data.experience_date ?? null,
          status: 'PUBLISHED',
        },
        { transaction: t }
      );

      await this.syncEntityRatingMetrics(entityId, t);
      return review;
    });
  }

  async updateReview(
    reviewId: string,
    data: UpdateReviewBody
  ): Promise<DirectoryReviewModel> {
    return this.sequelize.transaction(async (t) => {
      const review = await this.reviewModel.findByPk(reviewId, { transaction: t });
      if (!review) throw new Error('Reseña no encontrada');

      if (data.rating !== undefined) review.rating = data.rating;
      if (data.title !== undefined) review.title = data.title;
      if (data.body !== undefined) review.body = data.body;
      if (data.experience_date !== undefined) review.experienceDate = data.experience_date;
      review.editedAt = new Date();

      await review.save({ transaction: t });
      await this.syncEntityRatingMetrics(review.entityId, t);
      return review;
    });
  }

  async deleteReview(reviewId: string): Promise<void> {
    await this.sequelize.transaction(async (t) => {
      const review = await this.reviewModel.findByPk(reviewId, { transaction: t });
      if (!review) return;

      review.status = 'DELETED';
      await review.save({ transaction: t });
      await this.syncEntityRatingMetrics(review.entityId, t);
    });
  }

  async toggleHelpfulVote(
    reviewId: string,
    userId: string
  ): Promise<{ hasVoted: boolean; newCount: number }> {
    return this.sequelize.transaction(async (t) => {
      const existing = await this.helpfulVoteModel.findOne({
        where: { reviewId, userId },
        transaction: t,
      });

      const review = await this.reviewModel.findByPk(reviewId, { transaction: t });
      if (!review) throw new Error('Reseña no encontrada');

      if (existing) {
        await existing.destroy({ transaction: t });
        review.helpfulCount = Math.max(0, review.helpfulCount - 1);
        await review.save({ transaction: t });
        return { hasVoted: false, newCount: review.helpfulCount };
      } else {
        await this.helpfulVoteModel.create(
          { reviewId, userId },
          { transaction: t }
        );
        review.helpfulCount = review.helpfulCount + 1;
        await review.save({ transaction: t });
        return { hasVoted: true, newCount: review.helpfulCount };
      }
    });
  }

  async getUserHelpfulVoteIds(reviewIds: string[], userId: string): Promise<Set<string>> {
    if (reviewIds.length === 0) return new Set();
    const votes = await this.helpfulVoteModel.findAll({
      where: {
        reviewId: { [Op.in]: reviewIds },
        userId,
      },
      attributes: ['reviewId'],
    });
    return new Set(votes.map((v) => v.reviewId));
  }

  async getUserAvatars(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    try {
      const rows = await this.sequelize.query<{ user_id: string; url: string }>(
        `SELECT DISTINCT ON (user_id) user_id, url
           FROM profile.photos
          WHERE user_id IN (:userIds) AND hidden_at IS NULL
          ORDER BY user_id, position ASC, created_at ASC`,
        {
          type: QueryTypes.SELECT,
          replacements: { userIds },
        }
      );
      const map = new Map<string, string>();
      for (const r of rows) {
        map.set(r.user_id, r.url);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  // ==========================================
  // RESPUESTAS OFICIALES
  // ==========================================

  async createOrUpdateReply(
    reviewId: string,
    authorId: string,
    replyText: string
  ): Promise<DirectoryReviewReplyModel> {
    const existing = await this.reviewReplyModel.findOne({ where: { reviewId } });
    if (existing) {
      existing.replyText = replyText;
      return existing.save();
    }
    return this.reviewReplyModel.create({
      reviewId,
      authorId,
      replyText,
    });
  }

  async deleteReply(reviewId: string): Promise<void> {
    await this.reviewReplyModel.destroy({ where: { reviewId } });
  }

  // ==========================================
  // SINCRONIZACIÓN DE HISTOGRAMA Y MÉTRICAS
  // ==========================================

  async syncEntityRatingMetrics(entityId: string, transaction?: Transaction): Promise<void> {
    const reviews = await this.reviewModel.findAll({
      where: { entityId, status: 'PUBLISHED' },
      attributes: ['rating'],
      transaction,
    });

    const total = reviews.length;
    const breakdown = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    let sum = 0;

    for (const r of reviews) {
      sum += r.rating;
      if (r.rating >= 1 && r.rating <= 5) {
        const key = String(r.rating) as '1' | '2' | '3' | '4' | '5';
        breakdown[key] += 1;
      }
    }

    const avg = total > 0 ? Number((sum / total).toFixed(2)) : 0.0;

    await this.entityModel.update(
      {
        ratingAverage: avg,
        ratingCount: total,
        ratingBreakdown: breakdown,
      },
      { where: { id: entityId }, transaction }
    );
  }
}
