import { DirectoryEntitySummaryDto, mapDirectoryEntitySummary } from './directory.mapper';
import { EntityPlanModel } from './models/entity-plan.model';

/** A plan as the public marketplace shows it: no internal metadata, the seller as a summary (D4). */
export type PublicPlanDto = {
  id: string;
  entityId: string;
  type: string;
  name: string;
  slug: string;
  description: string;
  benefits: string[];
  durationDays: number | null;
  currentPrice: string;
  currency: string;
  status: string;
  displayOrder: number;
  mediaUrls: string[];
  metadata: Record<string, never>;
  entity?: DirectoryEntitySummaryDto;
};

export function mapPublicPlan(plan: EntityPlanModel): PublicPlanDto {
  return {
    id: plan.id,
    entityId: plan.entityId,
    type: plan.type,
    name: plan.name,
    slug: plan.slug,
    description: plan.description,
    benefits: plan.benefits ?? [],
    durationDays: plan.durationDays,
    currentPrice: plan.currentPrice,
    currency: plan.currency,
    status: plan.status,
    displayOrder: plan.displayOrder,
    mediaUrls: plan.mediaUrls ?? [],
    // Los metadatos internos del comercio no salen en el listado público.
    metadata: {},
    entity: plan.entity ? mapDirectoryEntitySummary(plan.entity) : undefined,
  };
}
