import { Injectable } from '@nestjs/common';
import { QueryTypes, Transaction, UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { CreateLocationInput, UpdateLocationInput } from './business-listings.schemas';

export type LocationRow = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  latitude: string | null;
  longitude: string | null;
  businessHours: Record<string, { open: string; close: string }>;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

const COLUMNS = `id, name, address, city, latitude, longitude, business_hours AS "businessHours",
  display_order AS "displayOrder", created_at AS "createdAt", updated_at AS "updatedAt"`;

const COLUMN_OF: Record<keyof UpdateLocationInput, string> = {
  name: 'name',
  address: 'address',
  city: 'city',
  latitude: 'latitude',
  longitude: 'longitude',
  businessHours: 'business_hours',
  displayOrder: 'display_order',
};

/** Thrown when another location of the same business already has this name. */
export class LocationNameTakenError extends Error {}

/** `directory.entity_locations`: every query is scoped to one entity, so a foreign id is simply not found. */
@Injectable()
export class EntityLocationsRepository {
  constructor(private readonly sequelize: Sequelize) {}

  list(entityId: string): Promise<LocationRow[]> {
    return this.sequelize.query<LocationRow>(
      `SELECT ${COLUMNS} FROM directory.entity_locations WHERE entity_id = :entityId ORDER BY display_order, id`,
      { type: QueryTypes.SELECT, replacements: { entityId } },
    );
  }

  async count(entityId: string, transaction: Transaction): Promise<number> {
    const [row] = await this.sequelize.query<{ total: string }>(
      'SELECT count(*) AS total FROM directory.entity_locations WHERE entity_id = :entityId',
      { type: QueryTypes.SELECT, replacements: { entityId }, transaction },
    );
    return Number(row?.total ?? 0);
  }

  async create(entityId: string, input: CreateLocationInput, transaction: Transaction): Promise<string> {
    const rows = await this.run<{ id: string }>(
      `INSERT INTO directory.entity_locations (entity_id, name, address, city, latitude, longitude, business_hours, display_order)
       VALUES (:entityId, :name, :address, :city, :latitude, :longitude, CAST(:businessHours AS jsonb), :displayOrder) RETURNING id`,
      { entityId, ...input, businessHours: JSON.stringify(input.businessHours) },
      transaction,
    );
    return rows[0].id;
  }

  /** False when the location is not this entity's. Column names come from a closed map, never from input. */
  async update(entityId: string, locationId: string, patch: UpdateLocationInput, transaction: Transaction): Promise<boolean> {
    const keys = Object.keys(patch) as (keyof UpdateLocationInput)[];
    const sets = keys.map((key) => (key === 'businessHours' ? `business_hours = CAST(:businessHours AS jsonb)` : `${COLUMN_OF[key]} = :${key}`));
    const values: Record<string, unknown> = { ...patch, entityId, locationId };
    if (patch.businessHours) values.businessHours = JSON.stringify(patch.businessHours);
    const rows = await this.run<{ id: string }>(
      `UPDATE directory.entity_locations SET ${sets.join(', ')}, updated_at = now()
        WHERE id = :locationId AND entity_id = :entityId RETURNING id`,
      values,
      transaction,
    );
    return rows.length > 0;
  }

  async remove(entityId: string, locationId: string, transaction: Transaction): Promise<boolean> {
    const rows = await this.run<{ id: string }>(
      'DELETE FROM directory.entity_locations WHERE id = :locationId AND entity_id = :entityId RETURNING id',
      { entityId, locationId },
      transaction,
    );
    return rows.length > 0;
  }

  private async run<T extends object>(sql: string, replacements: Record<string, unknown>, transaction: Transaction): Promise<T[]> {
    try {
      return await this.sequelize.query<T>(sql, { type: QueryTypes.SELECT, replacements, transaction });
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) throw new LocationNameTakenError();
      throw error;
    }
  }
}
