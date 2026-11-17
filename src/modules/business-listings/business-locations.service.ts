import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { DomainException } from '../../common/errors/domain.exception';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { BusinessListingsService } from './business-listings.service';
import { CreateLocationInput, UpdateLocationInput } from './business-listings.schemas';
import { EntityLocationsRepository, LocationNameTakenError, LocationRow } from './entity-locations.repository';
import { ENTITY_LOCATIONS_MAX } from './listing.catalog';

export type PublicLocationDto = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  businessHours: Record<string, { open: string; close: string }>;
};
export type OwnLocationDto = PublicLocationDto & { displayOrder: number; createdAt: string; updatedAt: string };

export function mapPublicLocation(row: LocationRow): PublicLocationDto {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    city: row.city,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    businessHours: row.businessHours ?? {},
  };
}

function mapOwnLocation(row: LocationRow): OwnLocationDto {
  return {
    ...mapPublicLocation(row),
    displayOrder: row.displayOrder,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function nameTaken(): DomainException {
  return new DomainException(HttpStatus.CONFLICT, 'LOCATION_NAME_TAKEN', 'Ya tienes una sede con ese nombre.');
}

/** `business/me/locations*`: the business's declared locations (plan §2.3), public with its profile. */
@Injectable()
export class BusinessLocationsService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly listings: BusinessListingsService,
    private readonly repository: EntityLocationsRepository,
  ) {}

  async list(actor: AuthenticatedUser): Promise<OwnLocationDto[]> {
    const { account } = await this.listings.owner(actor);
    return (await this.repository.list(account.entityId)).map(mapOwnLocation);
  }

  async create(actor: AuthenticatedUser, input: CreateLocationInput): Promise<OwnLocationDto> {
    const { entityId, id } = await this.sequelize
      .transaction(async (transaction) => {
        const { account } = await this.listings.lockOwner(actor, transaction);
        // Counted under the listing's row lock: two parallel creates cannot both pass the cap.
        if ((await this.repository.count(account.entityId, transaction)) >= ENTITY_LOCATIONS_MAX) {
          throw new DomainException(HttpStatus.CONFLICT, 'LOCATION_LIMIT', `Puedes declarar hasta ${ENTITY_LOCATIONS_MAX} sedes.`);
        }
        return { entityId: account.entityId, id: await this.repository.create(account.entityId, input, transaction) };
      })
      .catch(rethrowNameTaken);
    return this.find(entityId, id);
  }

  async update(actor: AuthenticatedUser, locationId: string, patch: UpdateLocationInput): Promise<OwnLocationDto> {
    const entityId = await this.sequelize
      .transaction(async (transaction) => {
        const { account } = await this.listings.lockOwner(actor, transaction);
        if (!(await this.repository.update(account.entityId, locationId, patch, transaction))) throw notFound();
        return account.entityId;
      })
      .catch(rethrowNameTaken);
    return this.find(entityId, locationId);
  }

  async remove(actor: AuthenticatedUser, locationId: string): Promise<void> {
    await this.sequelize.transaction(async (transaction) => {
      const { account } = await this.listings.lockOwner(actor, transaction);
      if (!(await this.repository.remove(account.entityId, locationId, transaction))) throw notFound();
    });
  }

  private async find(entityId: string, locationId: string): Promise<OwnLocationDto> {
    const row = (await this.repository.list(entityId)).find((location) => location.id === locationId);
    if (!row) throw notFound();
    return mapOwnLocation(row);
  }
}

function notFound(): NotFoundException {
  return new NotFoundException('Sede no encontrada.');
}

function rethrowNameTaken(error: unknown): never {
  throw error instanceof LocationNameTakenError ? nameTaken() : error;
}
