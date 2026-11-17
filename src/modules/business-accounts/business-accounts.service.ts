import { BadRequestException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { Transaction } from 'sequelize';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { DirectoryEntityModel } from '../directory/directory-entity.model';
import { MediaReferenceReleaseService } from '../media/media-reference-release.service';
import {
  MEDIA_STORAGE_PROVIDER,
  MediaStorageProvider,
  isBusinessPublicKey,
} from '../media/media-storage.port';
import { UsersRepository } from '../users/users.repository';
import { UploadedSelfie, sniffSelfieType } from '../verification/selfie-image';
import { BusinessMeDto, mapBusinessMe } from './business-accounts.mapper';
import { BusinessAccountRow, BusinessAccountsRepository } from './business-accounts.repository';
import { BusinessMediaSlot, BusinessProfilePatch } from './business-accounts.schemas';
import { assertBusinessNameAllowed } from './business-name';
import { CurrentHandle, HandlesService } from './handles.service';

const SLOT_COLUMN = { LOGO: 'logoUrl', COVER: 'coverUrl' } as const;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);

/** The storage key of a stored URL when it is this listing's own public media; otherwise null. */
export function ownBusinessMediaKey(url: string | null, entityId: string, publicBaseUrl: string): string | null {
  if (!url) return null;
  const base = `${publicBaseUrl.replace(/\/+$/u, '')}/`;
  if (!url.startsWith(base)) return null;
  const key = url.slice(base.length);
  return isBusinessPublicKey(key) && key.startsWith(`business/${entityId}/public/`) ? key : null;
}

/** The business's own account and listing: what `business/me/*` reads and edits. */
@Injectable()
export class BusinessAccountsService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly repository: BusinessAccountsRepository,
    private readonly handles: HandlesService,
    private readonly users: UsersRepository,
    private readonly mediaRelease: MediaReferenceReleaseService,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
  ) {}

  async me(actor: AuthenticatedUser): Promise<BusinessMeDto> {
    const account = await this.requireAccount(actor);
    const entity = await this.repository.findEntity(account.entityId);
    if (!entity) throw new NotFoundException('Negocio no encontrado.');
    return mapBusinessMe(account, entity, await this.handles.current(account.entityId));
  }

  async updateProfile(actor: AuthenticatedUser, patch: BusinessProfilePatch): Promise<BusinessMeDto> {
    const account = await this.requireAccount(actor);
    if (patch.primaryCategoryId && !(await this.repository.categoryFits(patch.primaryCategoryId, account.entityType))) {
      throw new BadRequestException('Esa categoría no corresponde a tu tipo de negocio.');
    }
    await this.sequelize.transaction(async (transaction) => {
      const entity = await this.lockEditable(account, transaction);
      const newName = patch.name !== undefined && patch.name !== entity.name ? patch.name : null;
      const recategorized = patch.primaryCategoryId !== undefined && patch.primaryCategoryId !== entity.primaryCategoryId;
      // Past DRAFT a material change is a new KYC version reviewed by REPP (ADR-0021): never applied here.
      if ((newName !== null || recategorized) && entity.status !== 'DRAFT') {
        throw new DomainException(
          HttpStatus.CONFLICT,
          'BUSINESS_MATERIAL_CHANGE_REQUIRES_REVIEW',
          'El nombre y la categoría de un negocio publicado solo cambian con una nueva verificación.',
          { action: 'POST /business/me/kyc/changes' },
        );
      }
      // While REPP reviews the first verification, what it reviews does not change under it.
      if ((newName !== null || recategorized) && (account.kycStatus === 'SUBMITTED' || account.kycStatus === 'IN_REVIEW')) {
        throw new DomainException(HttpStatus.CONFLICT, 'KYC_NOT_EDITABLE', 'Tu solicitud ya está en revisión.', { action: 'WAIT' });
      }
      if (newName !== null) await assertBusinessNameAllowed(this.repository, newName, account.entityType, entity.id, transaction);
      await this.repository.updateEntity(entity, patch, transaction);
      // The commercial name is also the account's display name (not person data).
      if (newName !== null) await this.users.updateFullName(account.userId, newName, transaction);
    });
    return this.me(actor);
  }

  async claimHandle(actor: AuthenticatedUser, handle: string): Promise<CurrentHandle> {
    const account = await this.requireAccount(actor);
    // What REPP is reviewing does not change under it (ADR-0021).
    if (account.kycStatus === 'SUBMITTED' || account.kycStatus === 'IN_REVIEW') {
      throw new DomainException(HttpStatus.CONFLICT, 'KYC_NOT_EDITABLE', 'Tu solicitud ya está en revisión.', { action: 'WAIT' });
    }
    return this.sequelize.transaction(async (transaction) => {
      const entity = await this.lockEditable(account, transaction);
      return this.handles.claim(entity, handle, account.userId, transaction);
    });
  }

  /** Logo or cover: public, replaced in place; the previous file is released (ADR-0017). */
  async uploadMedia(
    actor: AuthenticatedUser,
    slot: BusinessMediaSlot,
    file: UploadedSelfie | undefined,
  ): Promise<{ slot: BusinessMediaSlot; url: string }> {
    const account = await this.requireAccount(actor);
    const image = validateBusinessImage(file);
    const stored = await this.storage.upload(
      { originalName: image.originalname, mimeType: image.mimeType, sizeBytes: image.size, buffer: image.buffer },
      { category: 'business', entityId: account.entityId },
    );
    await this.replaceSlot(account, slot, stored.url);
    return { slot, url: stored.url };
  }

  async removeMedia(actor: AuthenticatedUser, slot: BusinessMediaSlot): Promise<void> {
    await this.replaceSlot(await this.requireAccount(actor), slot, null);
  }

  private async replaceSlot(account: BusinessAccountRow, slot: BusinessMediaSlot, url: string | null): Promise<void> {
    const column = SLOT_COLUMN[slot];
    const before = await this.repository.findEntity(account.entityId);
    const previousKey = ownBusinessMediaKey(before?.[column] ?? null, account.entityId, env.MEDIA_STORAGE_PUBLIC_BASE_URL);
    const releasable = previousKey && previousKey !== keyOf(url) ? [previousKey] : [];
    await this.mediaRelease.clearAndRelease(
      { aggregateType: 'business.entity', aggregateId: account.entityId, storageKeys: releasable },
      async (transaction) => {
        const entity = await this.lockEditable(account, transaction);
        await this.repository.updateEntity(entity, slot === 'LOGO' ? { logoUrl: url } : { coverUrl: url }, transaction);
      },
    );
  }

  async requireAccount(actor: AuthenticatedUser): Promise<BusinessAccountRow> {
    const account = await this.repository.findByUserId(actor.id);
    if (!account) throw new NotFoundException('Cuenta de negocio no encontrada.');
    return account;
  }

  /** A suspended or closed business cannot edit its listing. */
  async lockEditable(account: BusinessAccountRow, transaction: Transaction): Promise<DirectoryEntityModel> {
    if (account.status === 'SUSPENDED' || account.status === 'CLOSED') {
      throw new DomainException(HttpStatus.CONFLICT, 'BUSINESS_ACCOUNT_LOCKED', 'Tu negocio no se puede editar en este estado.');
    }
    const entity = await this.repository.lockEntity(account.entityId, transaction);
    if (!entity) throw new NotFoundException('Negocio no encontrado.');
    return entity;
  }
}

function keyOf(url: string | null): string | null {
  if (!url) return null;
  const base = `${env.MEDIA_STORAGE_PUBLIC_BASE_URL.replace(/\/+$/u, '')}/`;
  return url.startsWith(base) ? url.slice(base.length) : null;
}

/** JPEG or PNG only, within the upload limit, and the bytes must match the declared type. */
export function validateBusinessImage(file: UploadedSelfie | undefined): UploadedSelfie & { mimeType: string } {
  if (!file || !file.buffer || file.size === 0) throw new BadRequestException('Se requiere una imagen no vacía.');
  if (file.size > env.MEDIA_UPLOAD_MAX_BYTES) {
    throw new BadRequestException(`La imagen excede el tamaño máximo de ${env.MEDIA_UPLOAD_MAX_BYTES} bytes.`);
  }
  const declared = file.mimetype.toLowerCase() === 'image/jpg' ? 'image/jpeg' : file.mimetype.toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(declared) || sniffSelfieType(file.buffer) !== declared) {
    throw new BadRequestException('Solo se admiten imágenes JPEG o PNG.');
  }
  return { ...file, mimeType: declared };
}
