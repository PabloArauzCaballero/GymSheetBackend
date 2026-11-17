import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { MediaReferenceReleaseService } from '../media/media-reference-release.service';
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from '../media/media-storage.port';
import { UploadedSelfie } from '../verification/selfie-image';
import { BusinessAccountsRepository } from './business-accounts.repository';
import { BusinessAccountsService, ownBusinessMediaKey, validateBusinessImage } from './business-accounts.service';

export const BUSINESS_GALLERY_MAX = 10;

function galleryLimit(): DomainException {
  return new DomainException(HttpStatus.CONFLICT, 'BUSINESS_GALLERY_LIMIT', `La galería admite hasta ${BUSINESS_GALLERY_MAX} fotos.`);
}

/**
 * The public gallery of a business profile (ADR-0022): uploaded files only,
 * public under `business/{entityId}/public/`, really deleted once nothing
 * references them (ADR-0017). Logo and cover stay in `BusinessAccountsService`.
 */
@Injectable()
export class BusinessGalleryService {
  constructor(
    private readonly accounts: BusinessAccountsService,
    private readonly repository: BusinessAccountsRepository,
    private readonly mediaRelease: MediaReferenceReleaseService,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
  ) {}

  async add(actor: AuthenticatedUser, file: UploadedSelfie | undefined): Promise<{ gallery: string[] }> {
    const image = validateBusinessImage(file);
    const account = await this.accounts.requireAccount(actor);
    const before = await this.repository.findEntity(account.entityId);
    if ((before?.gallery ?? []).length >= BUSINESS_GALLERY_MAX) throw galleryLimit();
    const stored = await this.storage.upload(
      { originalName: image.originalname, mimeType: image.mimeType, sizeBytes: image.size, buffer: image.buffer },
      { category: 'business', entityId: account.entityId },
    );
    let gallery: string[] = [];
    try {
      await this.mediaRelease.clearAndRelease({ aggregateType: 'business.entity', aggregateId: account.entityId, storageKeys: [] }, async (transaction) => {
        const entity = await this.accounts.lockEditable(account, transaction);
        const current = entity.gallery ?? [];
        // Re-checked under the row lock: two parallel uploads cannot both take the last slot.
        if (current.length >= BUSINESS_GALLERY_MAX) throw galleryLimit();
        gallery = [...current, stored.url];
        await entity.update({ gallery }, { transaction });
      });
    } catch (error: unknown) {
      const key = ownBusinessMediaKey(stored.url, account.entityId, env.MEDIA_STORAGE_PUBLIC_BASE_URL);
      if (key) await this.mediaRelease.clearAndRelease({ aggregateType: 'business.entity', aggregateId: account.entityId, storageKeys: [key] }, () => Promise.resolve());
      throw error;
    }
    return { gallery };
  }

  async remove(actor: AuthenticatedUser, position: number): Promise<{ gallery: string[] }> {
    const account = await this.accounts.requireAccount(actor);
    const url = ((await this.repository.findEntity(account.entityId))?.gallery ?? [])[position];
    if (url === undefined) throw new NotFoundException('Foto no encontrada.');
    const key = ownBusinessMediaKey(url, account.entityId, env.MEDIA_STORAGE_PUBLIC_BASE_URL);
    let gallery: string[] = [];
    await this.mediaRelease.clearAndRelease(
      { aggregateType: 'business.entity', aggregateId: account.entityId, storageKeys: key ? [key] : [] },
      async (transaction) => {
        const entity = await this.accounts.lockEditable(account, transaction);
        const current = entity.gallery ?? [];
        const index = current.indexOf(url);
        // Removed by value under the lock: the index read before may be stale.
        if (index < 0) throw new NotFoundException('Foto no encontrada.');
        gallery = current.filter((_, item) => item !== index);
        await entity.update({ gallery }, { transaction });
      },
    );
    return { gallery };
  }
}
