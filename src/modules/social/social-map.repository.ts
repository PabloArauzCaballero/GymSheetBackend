import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { QueryTypes } from "sequelize";
import { ProfileSocialSettingsModel } from "./profile-social-settings.model";
import { PublicMapCell } from "./social-map.policy";
import { SocialMapLocationModel } from "./social-map-location.model";
import { SocialMapPlaceModel } from "./social-map-place.model";
import { normalizeExternalPlace, PublicGymPlace } from "./gym-places.policy";

type EligibleCellRow = { cell_id: string; people_count: number | string };
type EligibleMapPersonRow = { user_id: string };

@Injectable()
export class SocialMapRepository {
  constructor(
    @InjectModel(SocialMapLocationModel) private readonly locations: typeof SocialMapLocationModel,
    @InjectModel(ProfileSocialSettingsModel) private readonly settings: typeof ProfileSocialSettingsModel,
    @InjectModel(SocialMapPlaceModel) private readonly places: typeof SocialMapPlaceModel,
  ) {}

  async listExternalGyms(bounds: { south: number; west: number; north: number; east: number }): Promise<PublicGymPlace[]> {
    const sequelize = this.places.sequelize;
    if (!sequelize) throw new Error("Social map database connection is unavailable.");
    const rows = await sequelize.query<{
      kind: "GYM"; source: "OPENSTREETMAP"; source_id: string; name: string; address: string | null;
      city: string | null; region: string | null; latitude: number; longitude: number;
      tags: Record<string, string>; license: "ODbL-1.0"; attribution: string; imported_at: Date;
    }>(
      `SELECT kind, source, source_id, name, address, city, region,
              latitude::float8 AS latitude, longitude::float8 AS longitude,
              tags, license, attribution, imported_at
         FROM social.gym_places AS place
        WHERE place.kind = 'GYM' AND place.active = TRUE
          AND place.latitude BETWEEN :south AND :north
          AND place.longitude BETWEEN :west AND :east
          AND NOT EXISTS (
            SELECT 1 FROM social.gym_place_branch_links AS link
             WHERE link.source = place.source AND link.source_id = place.source_id
          )
        ORDER BY place.name, place.source_id
        LIMIT 200`,
      { replacements: bounds, type: QueryTypes.SELECT },
    );
    return rows.map((row) => normalizeExternalPlace({
      kind: row.kind, source: row.source, sourceId: row.source_id, name: row.name,
      address: row.address, city: row.city, region: row.region, latitude: row.latitude,
      longitude: row.longitude, tags: row.tags, license: row.license, attribution: row.attribution,
      updatedAt: row.imported_at.toISOString(),
    }));
  }

  async searchCities(query: string): Promise<{ id: string; name: string; region: string | null; latitude: number; longitude: number; source: "OPENSTREETMAP" }[]> {
    const sequelize = this.places.sequelize;
    if (!sequelize) throw new Error("Social map database connection is unavailable.");
    const rows = await sequelize.query<{
      source_id: string; name: string; region: string | null; latitude: number; longitude: number;
    }>(
      `SELECT DISTINCT ON (lower(name), lower(COALESCE(region, '')))
              source_id, name, region, latitude::float8 AS latitude, longitude::float8 AS longitude
         FROM social.gym_places
        WHERE kind = 'CITY' AND active = TRUE AND name ILIKE :query
        ORDER BY lower(name), lower(COALESCE(region, '')),
                 (tags->>'place' = 'city') DESC, (tags->>'place' = 'town') DESC, source_id
        LIMIT 10`,
      { replacements: { query: `%${query.replace(/[\\%_]/g, (match) => `\\${match}`)}%` }, type: QueryTypes.SELECT },
    );
    return rows.map((row) => ({
      id: row.source_id, name: row.name, region: row.region, latitude: row.latitude,
      longitude: row.longitude, source: "OPENSTREETMAP" as const,
    }));
  }

  async savePrivateLocation(userId: string, location: { latitude: number; longitude: number }, cellId: string): Promise<void> {
    const sequelize = this.locations.sequelize;
    if (!sequelize) throw new Error("Social map database connection is unavailable.");
    await sequelize.query(
      `INSERT INTO social.map_locations (user_id, latitude, longitude, cell_id, updated_at)
       VALUES (:userId, :latitude, :longitude, :cellId, NOW())
       ON CONFLICT (user_id) DO UPDATE SET latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude, cell_id = EXCLUDED.cell_id, updated_at = NOW()`,
      { replacements: { userId, ...location, cellId }, type: QueryTypes.INSERT },
    );
  }

  async listEligibleMapCells(viewerId: string, cells: readonly PublicMapCell[]): Promise<{ cellId: string; count: number }[]> {
    if (cells.length === 0) return [];
    const sequelize = this.settings.sequelize;
    if (!sequelize) throw new Error("Social map database connection is unavailable.");
    const rows = await sequelize.query<EligibleCellRow>(
      `SELECT location.cell_id, COUNT(*)::integer AS people_count
         FROM social.map_locations AS location
         JOIN social.profile_settings AS settings ON settings.user_id = location.user_id
         JOIN public.usuarios AS user_account ON user_account.id = location.user_id
         LEFT JOIN public.perfiles_antropometricos AS profile ON profile.usuario_id = location.user_id
        WHERE location.cell_id IN (:cellIds)
          AND NOT EXISTS (
            SELECT 1 FROM social.user_blocks block
             WHERE (block.blocker_id = :viewerId AND block.blocked_id = location.user_id)
                OR (block.blocker_id = location.user_id AND block.blocked_id = :viewerId))
          AND settings.profile_enabled = TRUE
          AND settings.map_enabled = TRUE
          AND user_account.estado = 'ACTIVO'
          AND COALESCE(EXTRACT(YEAR FROM age(CURRENT_DATE, profile.fecha_nacimiento))::int, profile.edad, 0) >= 18
        GROUP BY location.cell_id`,
      { replacements: { viewerId, cellIds: cells.map((cell) => cell.id) }, type: QueryTypes.SELECT },
    );
    return rows.map((row) => ({ cellId: row.cell_id, count: Number(row.people_count) }));
  }

  async listEligibleMapPeople(viewerId: string, cellId: string): Promise<string[]> {
    const sequelize = this.settings.sequelize;
    if (!sequelize) throw new Error("Social map database connection is unavailable.");
    const rows = await sequelize.query<EligibleMapPersonRow>(
      `SELECT location.user_id
         FROM social.map_locations AS location
         JOIN social.profile_settings AS settings ON settings.user_id = location.user_id
         JOIN public.usuarios AS user_account ON user_account.id = location.user_id
         LEFT JOIN public.perfiles_antropometricos AS profile ON profile.usuario_id = location.user_id
        WHERE location.cell_id = :cellId
          AND NOT EXISTS (
            SELECT 1 FROM social.user_blocks block
             WHERE (block.blocker_id = :viewerId AND block.blocked_id = location.user_id)
                OR (block.blocker_id = location.user_id AND block.blocked_id = :viewerId))
          AND settings.profile_enabled = TRUE
          AND settings.map_enabled = TRUE
          AND user_account.estado = 'ACTIVO'
          AND COALESCE(EXTRACT(YEAR FROM age(CURRENT_DATE, profile.fecha_nacimiento))::int, profile.edad, 0) >= 18
        ORDER BY location.updated_at DESC, location.user_id
        LIMIT 30`,
      { replacements: { viewerId, cellId }, type: QueryTypes.SELECT },
    );
    return rows.map((row) => row.user_id);
  }

  /** Eligible people (consent, adult, active, not blocked) located in any of the given cells. */
  async listEligibleMapPeopleInCells(viewerId: string, cellIds: readonly string[]): Promise<{ userId: string; cellId: string }[]> {
    if (cellIds.length === 0) return [];
    const sequelize = this.settings.sequelize;
    if (!sequelize) throw new Error("Social map database connection is unavailable.");
    const rows = await sequelize.query<{ user_id: string; cell_id: string }>(
      `SELECT location.user_id, location.cell_id
         FROM social.map_locations AS location
         JOIN social.profile_settings AS settings ON settings.user_id = location.user_id
         JOIN public.usuarios AS user_account ON user_account.id = location.user_id
         LEFT JOIN public.perfiles_antropometricos AS profile ON profile.usuario_id = location.user_id
        WHERE location.cell_id IN (:cellIds)
          AND location.user_id <> :viewerId
          AND NOT EXISTS (
            SELECT 1 FROM social.user_blocks block
             WHERE (block.blocker_id = :viewerId AND block.blocked_id = location.user_id)
                OR (block.blocker_id = location.user_id AND block.blocked_id = :viewerId))
          AND settings.profile_enabled = TRUE
          AND settings.map_enabled = TRUE
          AND user_account.estado = 'ACTIVO'
          AND COALESCE(EXTRACT(YEAR FROM age(CURRENT_DATE, profile.fecha_nacimiento))::int, profile.edad, 0) >= 18
        ORDER BY location.updated_at DESC, location.user_id
        LIMIT 120`,
      { replacements: { viewerId, cellIds }, type: QueryTypes.SELECT },
    );
    return rows.map((row) => ({ userId: row.user_id, cellId: row.cell_id }));
  }
}
