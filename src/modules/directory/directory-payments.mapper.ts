import { DirectoryEntitySummaryDto, mapDirectoryEntitySummary } from './directory.mapper';
import { EntityPaymentConfigModel } from './models/entity-payment-config.model';
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

/**
 * What a buyer needs to pay by QR or transfer (D5). The seller's tax id is not
 * needed to pay and stays out; the account number stays because the transfer
 * needs it until franja 8d moves the payment data into the order.
 */
export type PublicPaymentConfigDto = {
  bankName: string;
  accountHolderName: string;
  accountNumber: string;
  aliasOrPhone: string | null;
  qrImageUrl: string;
  qrPayload: string | null;
  instructions: string | null;
  isActive: boolean;
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

/** Null when the seller has no active payment method: nothing can be bought then. */
export function mapPublicPaymentConfig(config: EntityPaymentConfigModel | null): PublicPaymentConfigDto | null {
  if (!config || !config.isActive) return null;
  return {
    bankName: config.bankName,
    accountHolderName: config.accountHolderName,
    accountNumber: config.accountNumber,
    aliasOrPhone: config.aliasOrPhone,
    qrImageUrl: config.qrImageUrl,
    qrPayload: config.qrPayload,
    instructions: config.instructions,
    isActive: config.isActive,
  };
}
