import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { ownBusinessMediaKey, validateBusinessImage } from '../business-accounts/business-accounts.service';
import { MediaReferenceReleaseService } from '../media/media-reference-release.service';
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from '../media/media-storage.port';
import { UploadedSelfie } from '../verification/selfie-image';
import { BusinessListingsRepository } from './business-listings.repository';
import { BusinessListingsService } from './business-listings.service';
import { LISTING_MEDIA_MAX } from './listing.catalog';
import { OwnListingDto } from './listings.mapper';

/**
 * Photos of a listing: uploaded by the seller (multipart, JPEG/PNG checked by
 * bytes), never a free URL; stored public under `business/{entityId}/public/`
 * and really deleted when nothing references them any more (ADR-0017).
 */
@Injectable()
export class ListingMediaService {
  constructor(
    private readonly listings: BusinessListingsService,
    private readonly repository: BusinessListingsRepository,
    private readonly mediaRelease: MediaReferenceReleaseService,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
  ) {}

  async add(actor: AuthenticatedUser, listingId: string, file: UploadedSelfie | undefined): Promise<OwnListingDto> {
    const image = validateBusinessImage(file);
    const { account } = await this.listings.owner(actor);
    const current = await this.listings.requireOwn(account.entityId, listingId);
    if ((current.mediaUrls ?? []).length >= LISTING_MEDIA_MAX) throw mediaLimit();
    const stored = await this.storage.upload(
      { originalName: image.originalname, mimeType: image.mimeType, sizeBytes: image.size, buffer: image.buffer },
      { category: 'business', entityId: account.entityId },
    );
    const uploadedKey = ownBusinessMediaKey(stored.url, account.entityId, env.MEDIA_STORAGE_PUBLIC_BASE_URL);
    try {
      await this.mediaRelease.clearAndRelease({ aggregateType: 'directory.entity_plan', aggregateId: listingId, storageKeys: [] }, async (transaction) => {
        await this.listings.lockOwner(actor, transaction);
        const listing = await this.listings.requireEditable(account.entityId, listingId, transaction);
        const urls = listing.mediaUrls ?? [];
        // Re-checked under the lock: two parallel uploads cannot both take the last slot.
        if (urls.length >= LISTING_MEDIA_MAX) throw mediaLimit();
        await this.repository.update(listing, { mediaUrls: [...urls, stored.url] }, transaction);
      });
    } catch (error: unknown) {
      // The row never referenced the new file: it is released at once instead of orphaned.
      if (uploadedKey) {
        await this.mediaRelease.clearAndRelease({ aggregateType: 'directory.entity_plan', aggregateId: listingId, storageKeys: [uploadedKey] }, () => Promise.resolve());
      }
      throw error;
    }
    return this.listings.get(actor, listingId);
  }

  async remove(actor: AuthenticatedUser, listingId: string, position: number): Promise<OwnListingDto> {
    const { account } = await this.listings.owner(actor);
    const before = await this.listings.requireOwn(account.entityId, listingId);
    const url = (before.mediaUrls ?? [])[position];
    if (url === undefined) throw new NotFoundException('Foto no encontrada.');
    const key = ownBusinessMediaKey(url, account.entityId, env.MEDIA_STORAGE_PUBLIC_BASE_URL);
    await this.mediaRelease.clearAndRelease(
      { aggregateType: 'directory.entity_plan', aggregateId: listingId, storageKeys: key ? [key] : [] },
      async (transaction) => {
        await this.listings.lockOwner(actor, transaction);
        const listing = await this.listings.requireEditable(account.entityId, listingId, transaction);
        const urls = listing.mediaUrls ?? [];
        // The photo may have moved since it was read: remove it by value, not by a stale index.
        if (!urls.includes(url)) throw new NotFoundException('Foto no encontrada.');
        await this.repository.update(listing, { mediaUrls: urls.filter((_, index) => index !== urls.indexOf(url)) }, transaction);
      },
    );
    return this.listings.get(actor, listingId);
  }
}

function mediaLimit(): DomainException {
  return new DomainException(HttpStatus.CONFLICT, 'LISTING_MEDIA_LIMIT', `Una publicación admite hasta ${LISTING_MEDIA_MAX} fotos.`);
}
