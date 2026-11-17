import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { CategoryModel } from './category.model';
import { DirectoryEntityModel } from './directory-entity.model';
import { EntityPlanModel } from './models/entity-plan.model';

/** Reads behind the legacy public plan routes. */
@Injectable()
export class DirectoryPaymentsRepository {
  constructor(
    @InjectModel(DirectoryEntityModel)
    private readonly entityModel: typeof DirectoryEntityModel,
    @InjectModel(EntityPlanModel)
    private readonly planModel: typeof EntityPlanModel,
  ) {}

  findEntityById(entityId: string): Promise<DirectoryEntityModel | null> {
    return this.entityModel.findByPk(entityId);
  }

  findPlanById(planId: string): Promise<EntityPlanModel | null> {
    return this.planModel.findByPk(planId, { include: [{ model: DirectoryEntityModel }] });
  }

  /** Public read: a held, hidden or rejected listing is not for sale (ADR-0022). */
  listPlans(entityId: string): Promise<EntityPlanModel[]> {
    return this.planModel.findAll({
      where: { entityId, status: 'ACTIVE', moderationStatus: 'LIVE' },
      order: [['displayOrder', 'ASC'], ['createdAt', 'DESC']],
    });
  }

  listAllMarketplacePlans(type?: string, limit = 50): Promise<EntityPlanModel[]> {
    return this.planModel.findAll({
      where: { status: 'ACTIVE', moderationStatus: 'LIVE', ...(type ? { type } : {}) },
      include: [
        {
          model: DirectoryEntityModel,
          // Inner join: a plan of a seller that is not public is not for sale (D7).
          where: { status: 'ACTIVE' },
          required: true,
          include: [{ model: CategoryModel, as: 'primaryCategory' }],
        },
      ],
      order: [['displayOrder', 'ASC'], ['createdAt', 'DESC']],
      limit,
    });
  }
}
