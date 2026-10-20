import { resolveMediaUrl, resolveMediaUrls } from '../../common/media/media-url';
import { CategoryModel } from './category.model';
import { DirectoryEntityModel } from './directory-entity.model';
import { DirectoryReviewModel } from './directory-review.model';

export { resolveMediaUrl, resolveMediaUrls };

export type CategoryTreeNodeDto = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconKey: string | null;
  path: string;
  entityScope: string;
  children: CategoryTreeNodeDto[];
};

export type DirectoryEntitySummaryDto = {
  id: string;
  slug: string;
  entityType: string;
  name: string;
  headline: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  primaryCategory: {
    id: string;
    name: string;
    slug: string;
    path: string;
  };
  city: string | null;
  country: string | null;
  isOnlineOnly: boolean;
  isVerified: boolean;
  ratingAverage: number;
  ratingCount: number;
};

export type DirectoryEntityDetailDto = DirectoryEntitySummaryDto & {
  description: string;
  gallery: string[];
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  contactInfo: Record<string, string>;
  businessHours: Record<string, { open: string; close: string }>;
  ratingBreakdown: { '1': number; '2': number; '3': number; '4': number; '5': number };
  secondaryCategories: Array<{
    id: string;
    name: string;
    slug: string;
    path: string;
  }>;
};

export type ReviewItemDto = {
  id: string;
  entityId: string;
  author: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  };
  rating: number;
  title: string;
  body: string;
  isVerifiedAthlete: boolean;
  helpfulCount: number;
  hasVotedHelpful: boolean;
  reply: {
    id: string;
    authorName: string;
    authorRole: string;
    replyText: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  createdAt: string;
  editedAt: string | null;
};

/**
 * Convierte una lista plana de categorías con parent_id en un árbol jerárquico.
 */
export function buildCategoryTree(categories: CategoryModel[]): CategoryTreeNodeDto[] {
  const map = new Map<string, CategoryTreeNodeDto>();
  const roots: CategoryTreeNodeDto[] = [];

  for (const cat of categories) {
    map.set(cat.id, {
      id: cat.id,
      slug: cat.slug,
      name: cat.name,
      description: cat.description,
      iconKey: cat.iconKey,
      path: cat.path,
      entityScope: cat.entityScope,
      children: [],
    });
  }

  for (const cat of categories) {
    const node = map.get(cat.id)!;
    if (cat.parentId && map.has(cat.parentId)) {
      map.get(cat.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function mapDirectoryEntitySummary(entity: DirectoryEntityModel): DirectoryEntitySummaryDto {
  return {
    id: entity.id,
    slug: entity.slug,
    entityType: entity.entityType,
    name: entity.name,
    headline: entity.headline,
    logoUrl: resolveMediaUrl(entity.logoUrl),
    coverUrl: resolveMediaUrl(entity.coverUrl),
    primaryCategory: {
      id: entity.primaryCategory?.id ?? entity.primaryCategoryId,
      name: entity.primaryCategory?.name ?? '',
      slug: entity.primaryCategory?.slug ?? '',
      path: entity.primaryCategory?.path ?? '',
    },
    city: entity.city,
    country: entity.country,
    isOnlineOnly: entity.isOnlineOnly,
    isVerified: entity.isVerified,
    ratingAverage: Number(entity.ratingAverage) || 0,
    ratingCount: entity.ratingCount,
  };
}

export function mapDirectoryEntityDetail(entity: DirectoryEntityModel): DirectoryEntityDetailDto {
  const summary = mapDirectoryEntitySummary(entity);
  const secondary = (entity.secondaryCategories ?? []).map((cat) => ({
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
    path: cat.path,
  }));

  const breakdown = entity.ratingBreakdown || { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };

  return {
    ...summary,
    description: entity.description,
    gallery: (Array.isArray(entity.gallery) ? entity.gallery : [])
      .map((item) => resolveMediaUrl(item))
      .filter((item): item is string => Boolean(item)),
    address: entity.address,
    latitude: entity.latitude ? Number(entity.latitude) : null,
    longitude: entity.longitude ? Number(entity.longitude) : null,
    contactInfo: entity.contactInfo || {},
    businessHours: entity.businessHours || {},
    ratingBreakdown: {
      '1': Number(breakdown['1']) || 0,
      '2': Number(breakdown['2']) || 0,
      '3': Number(breakdown['3']) || 0,
      '4': Number(breakdown['4']) || 0,
      '5': Number(breakdown['5']) || 0,
    },
    secondaryCategories: secondary,
  };
}

export function mapReviewItem(
  review: DirectoryReviewModel,
  votedReviewIds: Set<string> = new Set(),
  avatarsMap: Map<string, string> = new Map()
): ReviewItemDto {
  const authorId = review.user?.id ?? review.userId;
  return {
    id: review.id,
    entityId: review.entityId,
    author: {
      id: authorId,
      displayName: review.user?.fullName ?? review.user?.email ?? 'Atleta GymSheet',
      avatarUrl: resolveMediaUrl(avatarsMap.get(authorId) ?? null),
    },
    rating: review.rating,
    title: review.title,
    body: review.body,
    isVerifiedAthlete: review.isVerifiedAthlete,
    helpfulCount: review.helpfulCount,
    hasVotedHelpful: votedReviewIds.has(review.id),
    reply: review.reply
      ? {
          id: review.reply.id,
          authorName: review.reply.author?.fullName ?? 'Propietario Oficial',
          authorRole: 'Propietario',
          replyText: review.reply.replyText,
          createdAt: review.reply.createdAt.toISOString(),
          updatedAt: review.reply.updatedAt.toISOString(),
        }
      : null,
    createdAt: review.createdAt.toISOString(),
    editedAt: review.editedAt ? review.editedAt.toISOString() : null,
  };
}
