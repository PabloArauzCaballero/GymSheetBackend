import { Injectable, NotFoundException } from '@nestjs/common';
import { DirectoryEntityDetailDto } from '../directory/directory.mapper';
import { HandlesService } from '../business-accounts/handles.service';
import { PublicListingsQuery } from './business-listings.schemas';
import { EntityLocationsRepository } from './entity-locations.repository';
import { decodeKeyset, decodePriceKeyset, encodeCursor } from './keyset-cursor';
import { PublicListingDto, mapPublicListing } from './listings.mapper';
import { PublicListingRow, PublicListingsRepository, SearchKeyset } from './public-listings.repository';
import { PublicLocationDto, mapPublicLocation } from './business-locations.service';

export type ListingPage = { items: PublicListingDto[]; nextCursor: string | null };
export type PublicProfileDto =
  | { handle: string; entity: DirectoryEntityDetailDto; locations: PublicLocationDto[]; listings: ListingPage }
  | { redirectTo: string };

/** The public marketplace (ADR-0022): search, listing detail and the business profile by @handle. */
@Injectable()
export class PublicListingsService {
  constructor(
    private readonly repository: PublicListingsRepository,
    private readonly locations: EntityLocationsRepository,
    private readonly handles: HandlesService,
  ) {}

  async search(query: PublicListingsQuery): Promise<ListingPage> {
    const rows = await this.repository.search(query, afterOf(query), query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(mapPublicListing),
      nextCursor: rows.length > query.limit && last ? cursorOf(query.sort, last) : null,
    };
  }

  /** A listing that is not public (held, hidden, paused, or its seller is not ACTIVE) does not exist here. */
  async get(listingId: string): Promise<PublicListingDto> {
    const row = await this.repository.findPublic(listingId);
    if (!row) throw new NotFoundException('Publicación no encontrada.');
    return mapPublicListing(row);
  }

  /** `/@handle`: the profile, its locations and the first page of its listings; a retired handle redirects. */
  async profile(handle: string): Promise<PublicProfileDto> {
    const resolved = await this.handles.resolve(handle);
    if ('redirectTo' in resolved) return resolved;
    const [locations, listings] = await Promise.all([
      this.locations.list(resolved.entity.id),
      this.search({ entity_id: resolved.entity.id, sort: 'recent', limit: 20 }),
    ]);
    return { handle: resolved.handle, entity: resolved.entity, locations: locations.map(mapPublicLocation), listings };
  }
}

function afterOf(query: PublicListingsQuery): SearchKeyset | null {
  if (query.sort === 'recent') {
    const after = decodeKeyset(query.cursor);
    return after ? { kind: 'recent', at: after.key, id: after.id } : null;
  }
  const after = decodePriceKeyset(query.cursor);
  return after ? { kind: 'price', ...after } : null;
}

function cursorOf(sort: PublicListingsQuery['sort'], last: PublicListingRow): string {
  return sort === 'recent' ? encodeCursor(last.publishedKey, last.id) : encodeCursor(String(last.price), last.id);
}
