import { resolveMediaUrl } from '../../common/media/media-url';
import { DirectoryEntityModel } from '../directory/directory-entity.model';
import { BusinessAccountRow } from './business-accounts.repository';
import { CurrentHandle } from './handles.service';

/** What the business still has to do, in wizard order. KYC arrives in franja 8b. */
export type BusinessNextStep = 'VERIFY_EMAIL' | 'CHOOSE_HANDLE' | 'COMPLETE_PROFILE' | 'SUBMIT_KYC';

export type BusinessSummaryDto = {
  entityId: string;
  entityType: string;
  legalKind: string;
  status: string;
  kycStatus: string;
};

export type BusinessMeDto = {
  account: BusinessSummaryDto & {
    userId: string;
    email: string;
    emailVerified: boolean;
    accountKind: 'BUSINESS';
    createdAt: string;
  };
  entity: {
    id: string;
    slug: string;
    entityType: string;
    status: string;
    isVerified: boolean;
    name: string;
    headline: string | null;
    description: string;
    primaryCategoryId: string | null;
    city: string | null;
    country: string | null;
    address: string | null;
    isOnlineOnly: boolean;
    logoUrl: string | null;
    coverUrl: string | null;
    contactInfo: Record<string, string>;
    businessHours: Record<string, { open: string; close: string }>;
  };
  handle: CurrentHandle | null;
  nextSteps: BusinessNextStep[];
};

export function mapBusinessSummary(account: Pick<BusinessAccountRow, 'entityId' | 'entityType' | 'legalKind' | 'status' | 'kycStatus'>): BusinessSummaryDto {
  return {
    entityId: account.entityId,
    entityType: account.entityType,
    legalKind: account.legalKind,
    status: account.status,
    kycStatus: account.kycStatus,
  };
}

export function mapBusinessMe(
  account: BusinessAccountRow,
  entity: DirectoryEntityModel,
  handle: CurrentHandle | null,
): BusinessMeDto {
  const emailVerified = Boolean(account.emailVerifiedAt);
  const nextSteps: BusinessNextStep[] = [];
  if (!emailVerified) nextSteps.push('VERIFY_EMAIL');
  if (!handle) nextSteps.push('CHOOSE_HANDLE');
  if (!entity.primaryCategoryId || !entity.city) nextSteps.push('COMPLETE_PROFILE');
  if (account.kycStatus === 'DRAFT') nextSteps.push('SUBMIT_KYC');
  return {
    account: {
      ...mapBusinessSummary(account),
      userId: account.userId,
      email: account.email,
      emailVerified,
      accountKind: 'BUSINESS',
      createdAt: new Date(account.createdAt).toISOString(),
    },
    entity: {
      id: entity.id,
      slug: entity.slug,
      entityType: entity.entityType,
      status: entity.status,
      isVerified: entity.isVerified,
      name: entity.name,
      headline: entity.headline,
      description: entity.description,
      primaryCategoryId: entity.primaryCategoryId,
      city: entity.city,
      country: entity.country,
      address: entity.address,
      isOnlineOnly: entity.isOnlineOnly,
      logoUrl: resolveMediaUrl(entity.logoUrl),
      coverUrl: resolveMediaUrl(entity.coverUrl),
      contactInfo: entity.contactInfo ?? {},
      businessHours: entity.businessHours ?? {},
    },
    handle,
    nextSteps,
  };
}
