import { Injectable, NotFoundException } from '@nestjs/common';
import { DirectoryPaymentsRepository } from './directory-payments.repository';
import { PublicPlanDto, mapPublicPlan } from './directory-payments.mapper';

/**
 * Legacy public reads of the directory plans (`/public/directory/plans*`),
 * kept for the clients that still call them; the marketplace search is
 * `/public/directory/listings` (ADR-0022). Orders, payment data and the
 * catalog console moved to `business-orders` and `business-listings`
 * (ADR-0024): REPP no longer manages a listing or its money (D9).
 */
@Injectable()
export class DirectoryPaymentsService {
  constructor(private readonly repository: DirectoryPaymentsRepository) {}

  /** Public: the active plans of a listing people can see (D4, D7). */
  async listPublicPlans(entityId: string): Promise<PublicPlanDto[]> {
    const entity = await this.repository.findEntityById(entityId);
    if (!entity || entity.status !== 'ACTIVE') throw new NotFoundException('Entidad del directorio no encontrada.');
    return (await this.repository.listPlans(entityId)).map(mapPublicPlan);
  }

  /** Public marketplace: plans of listings that are ACTIVE only; a paused or suspended seller sells nothing (D7). */
  async listAllMarketplacePlans(type?: string, limit = 50): Promise<PublicPlanDto[]> {
    return (await this.repository.listAllMarketplacePlans(type, limit)).map(mapPublicPlan);
  }

  /** Public: an active plan of an active listing, mapped (D4); anything else is 404. */
  async getPublicPlan(planId: string): Promise<PublicPlanDto> {
    const plan = await this.repository.findPlanById(planId);
    if (!plan || plan.status !== 'ACTIVE' || plan.moderationStatus !== 'LIVE' || plan.entity?.status !== 'ACTIVE') {
      throw new NotFoundException('Plan o producto no encontrado.');
    }
    return mapPublicPlan(plan);
  }
}
