import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { BusinessAccountRow, BusinessAccountsRepository } from '../business-accounts/business-accounts.repository';
import { DirectoryEntityModel } from '../directory/directory-entity.model';
import { EntityPlanModel } from '../directory/models/entity-plan.model';
import { CreateListingInput, ListingPriceInput, ListingStockInput, OwnListingsQuery, UpdateListingInput } from './business-listings.schemas';
import { BusinessListingsRepository } from './business-listings.repository';
import { ListingShape, shapeViolations } from './listing-checks';
import { LEGACY_TYPE_OF, LISTINGS_MAX, LISTING_CURRENCY, listingSlug } from './listing.catalog';
import { CheckScope, ListingPublicationService } from './listing-publication.service';
import { OwnListingDto, mapOwnListing } from './listings.mapper';
import { decodeKeyset, encodeCursor } from './keyset-cursor';

type Transition = 'pause' | 'resume' | 'archive';
const TRANSITIONS: Record<Transition, { from: readonly string[]; to: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' }> = {
  pause: { from: ['ACTIVE'], to: 'INACTIVE' },
  resume: { from: ['INACTIVE'], to: 'ACTIVE' },
  archive: { from: ['ACTIVE', 'INACTIVE'], to: 'ARCHIVED' },
};

/** What the account is allowed to do with its own listings; a suspended or closed business edits nothing. */
export type OwnerContext = { account: BusinessAccountRow; entity: DirectoryEntityModel };

/** `business/me/listings*` (ADR-0022): the seller's own plans, passes, services and products. */
@Injectable()
export class BusinessListingsService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly accounts: BusinessAccountsRepository,
    private readonly repository: BusinessListingsRepository,
    private readonly publication: ListingPublicationService,
  ) {}

  async list(actor: AuthenticatedUser, query: OwnListingsQuery): Promise<{ items: OwnListingDto[]; nextCursor: string | null }> {
    const { account, entity } = await this.owner(actor);
    const after = decodeKeyset(query.cursor);
    const rows = await this.repository.listOwn(account.entityId, query, after, query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => mapOwnListing(row, entity.status)),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.cursorKey, last.id) : null,
    };
  }

  async get(actor: AuthenticatedUser, listingId: string): Promise<OwnListingDto> {
    const { account, entity } = await this.owner(actor);
    return mapOwnListing(await this.requireOwn(account.entityId, listingId), entity.status);
  }

  async create(actor: AuthenticatedUser, input: CreateListingInput): Promise<OwnListingDto> {
    const listing = await this.sequelize.transaction(async (transaction) => {
      const { account } = await this.lockOwner(actor, transaction);
      await this.assertShape({ offerKind: input.offerKind, ...pickShape(input) }, account);
      // Counted under the row lock of the business's listing: parallel creates cannot pass the cap together.
      if ((await this.repository.countOpen(account.entityId, transaction)) >= LISTINGS_MAX) {
        throw new DomainException(HttpStatus.CONFLICT, 'LISTING_LIMIT', `Puedes tener hasta ${LISTINGS_MAX} publicaciones sin archivar.`);
      }
      const outcome = await this.publication.evaluate({ ...input }, null, { text: true, price: true }, transaction);
      const created = await this.repository.create(
        {
          slug: listingSlug(input.name),
          entityId: account.entityId,
          offerKind: input.offerKind,
          type: LEGACY_TYPE_OF[input.offerKind],
          name: input.name,
          description: input.description,
          benefits: input.benefits,
          durationDays: input.validityDays,
          sessionsCount: input.sessionsCount,
          stockQuantity: input.stockQuantity,
          productCategoryId: input.productCategoryId,
          displayOrder: input.displayOrder,
          currentPrice: input.price.toFixed(2),
          currency: LISTING_CURRENCY,
          status: 'ACTIVE',
          mediaUrls: [],
          metadata: {},
          ...outcome,
        },
        transaction,
      );
      await this.repository.recordPrice(
        { listingId: created.id, price: created.currentPrice, currency: LISTING_CURRENCY, actorUserId: actor.id, reason: 'Precio inicial', at: new Date() },
        transaction,
      );
      return created;
    });
    return this.get(actor, listing.id);
  }

  async update(actor: AuthenticatedUser, listingId: string, patch: UpdateListingInput): Promise<OwnListingDto> {
    await this.sequelize.transaction(async (transaction) => {
      const { account } = await this.lockOwner(actor, transaction);
      const listing = await this.requireEditable(account.entityId, listingId, transaction);
      const merged: ListingShape = {
        offerKind: listing.offerKind,
        validityDays: patch.validityDays !== undefined ? patch.validityDays : listing.durationDays,
        sessionsCount: patch.sessionsCount !== undefined ? patch.sessionsCount : listing.sessionsCount,
        stockQuantity: listing.stockQuantity,
        productCategoryId: patch.productCategoryId !== undefined ? patch.productCategoryId : listing.productCategoryId,
      };
      await this.assertShape(merged, account);
      const candidate = {
        offerKind: listing.offerKind,
        name: patch.name ?? listing.name,
        description: patch.description ?? listing.description,
        benefits: patch.benefits ?? listing.benefits ?? [],
        price: Number(listing.currentPrice),
      };
      const scope: CheckScope = { text: patch.name !== undefined || patch.description !== undefined || patch.benefits !== undefined, price: false };
      const outcome = await this.publication.evaluate(candidate, listing, scope, transaction);
      await this.repository.update(
        listing,
        {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.benefits !== undefined ? { benefits: patch.benefits } : {}),
          ...(patch.displayOrder !== undefined ? { displayOrder: patch.displayOrder } : {}),
          durationDays: merged.validityDays,
          sessionsCount: merged.sessionsCount,
          productCategoryId: merged.productCategoryId,
          ...outcome,
        },
        transaction,
      );
    });
    return this.get(actor, listingId);
  }

  /** The price goes through the append-only history and is re-checked against the band and the median. */
  async changePrice(actor: AuthenticatedUser, listingId: string, input: ListingPriceInput): Promise<OwnListingDto> {
    await this.sequelize.transaction(async (transaction) => {
      const { account } = await this.lockOwner(actor, transaction);
      const listing = await this.requireEditable(account.entityId, listingId, transaction);
      const price = input.price.toFixed(2);
      if (price === listing.currentPrice) {
        throw new DomainException(HttpStatus.BAD_REQUEST, 'LISTING_SAME_PRICE', 'El nuevo precio debe ser distinto del actual.');
      }
      const candidate = { offerKind: listing.offerKind, name: listing.name, description: listing.description, benefits: listing.benefits ?? [], price: input.price };
      const outcome = await this.publication.evaluate(candidate, listing, { text: false, price: true }, transaction);
      await this.repository.recordPrice(
        { listingId, price, currency: LISTING_CURRENCY, actorUserId: actor.id, reason: input.reason ?? 'Cambio de precio', at: new Date() },
        transaction,
      );
      await this.repository.update(listing, { currentPrice: price, currency: LISTING_CURRENCY, ...outcome }, transaction);
    });
    return this.get(actor, listingId);
  }

  async changeStock(actor: AuthenticatedUser, listingId: string, input: ListingStockInput): Promise<OwnListingDto> {
    await this.sequelize.transaction(async (transaction) => {
      const { account } = await this.lockOwner(actor, transaction);
      const listing = await this.requireEditable(account.entityId, listingId, transaction);
      if (listing.offerKind !== 'PRODUCT') throw shapeError(['STOCK_NOT_ALLOWED']);
      // Units already promised to open orders (franja 8d) cannot disappear.
      if (input.stockQuantity !== null && input.stockQuantity < listing.stockReserved) {
        throw new DomainException(HttpStatus.CONFLICT, 'LISTING_STOCK_BELOW_RESERVED', 'El stock no puede ser menor que las unidades reservadas.', {
          reserved: listing.stockReserved,
        });
      }
      await this.repository.update(listing, { stockQuantity: input.stockQuantity }, transaction);
    });
    return this.get(actor, listingId);
  }

  async transition(actor: AuthenticatedUser, listingId: string, transition: Transition): Promise<OwnListingDto> {
    await this.sequelize.transaction(async (transaction) => {
      const { account } = await this.lockOwner(actor, transaction);
      const listing = await this.requireOwn(account.entityId, listingId, transaction);
      const rule = TRANSITIONS[transition];
      if (!rule.from.includes(listing.status)) {
        throw new DomainException(HttpStatus.CONFLICT, 'LISTING_INVALID_TRANSITION', 'La publicación no está en un estado que lo permita.', {
          status: listing.status,
        });
      }
      await this.repository.update(listing, { status: rule.to }, transaction);
    });
    return this.get(actor, listingId);
  }

  /** The account and its listing, for reads. */
  async owner(actor: AuthenticatedUser): Promise<OwnerContext> {
    const account = await this.accounts.findByUserId(actor.id);
    const entity = account ? await this.accounts.findEntity(account.entityId) : null;
    if (!account || !entity) throw new NotFoundException('Cuenta de negocio no encontrada.');
    return { account, entity };
  }

  /** Serializes writes per business (row lock on its listing) and refuses a suspended or closed one. */
  async lockOwner(actor: AuthenticatedUser, transaction: Transaction): Promise<OwnerContext> {
    const account = await this.accounts.findByUserId(actor.id, transaction);
    if (!account) throw new NotFoundException('Cuenta de negocio no encontrada.');
    if (account.status === 'SUSPENDED' || account.status === 'CLOSED') {
      throw new DomainException(HttpStatus.CONFLICT, 'BUSINESS_ACCOUNT_LOCKED', 'Tu negocio no se puede editar en este estado.');
    }
    const entity = await this.accounts.lockEntity(account.entityId, transaction);
    if (!entity) throw new NotFoundException('Negocio no encontrado.');
    return { account, entity };
  }

  async requireOwn(entityId: string, listingId: string, transaction?: Transaction): Promise<EntityPlanModel> {
    const listing = await this.repository.findOwn(entityId, listingId, transaction);
    if (!listing) throw new NotFoundException('Publicación no encontrada.');
    return listing;
  }

  /** An archived listing is history: it is read, never edited. */
  async requireEditable(entityId: string, listingId: string, transaction: Transaction): Promise<EntityPlanModel> {
    const listing = await this.requireOwn(entityId, listingId, transaction);
    if (listing.status === 'ARCHIVED') {
      throw new DomainException(HttpStatus.CONFLICT, 'LISTING_NOT_EDITABLE', 'Una publicación archivada no se edita.');
    }
    return listing;
  }

  private async assertShape(shape: ListingShape, account: BusinessAccountRow): Promise<void> {
    const violations = shapeViolations(shape);
    if (violations.length > 0) throw shapeError(violations);
    if (shape.productCategoryId && !(await this.accounts.categoryFits(shape.productCategoryId, account.entityType))) {
      throw new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, 'LISTING_CATEGORY_INVALID', 'Esa categoría no corresponde a tu tipo de negocio.');
    }
  }
}

function pickShape(input: CreateListingInput): Omit<ListingShape, 'offerKind'> {
  return {
    validityDays: input.validityDays,
    sessionsCount: input.sessionsCount,
    stockQuantity: input.stockQuantity,
    productCategoryId: input.productCategoryId,
  };
}

function shapeError(violations: readonly string[]): DomainException {
  return new DomainException(HttpStatus.UNPROCESSABLE_ENTITY, 'LISTING_SHAPE_INVALID', 'Faltan o sobran datos para este tipo de publicación.', {
    violations,
  });
}
