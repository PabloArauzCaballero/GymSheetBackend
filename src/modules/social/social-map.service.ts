import { ForbiddenException, Injectable } from "@nestjs/common";
import { SocialRepository } from "./social.repository";
import { env } from "../../config/env";
import { mapDirectoryRowToResponse } from "./social.mapper";
import { MapBounds, MapCoordinates, mapCellForLocation, mapCellsForBounds } from "./social-map.policy";
import { SocialMapRepository } from "./social-map.repository";

@Injectable()
export class SocialMapService {
  constructor(
    private readonly repository: SocialMapRepository,
    private readonly socialRepository: SocialRepository,
  ) {}

  async setLocation(userId: string, location: MapCoordinates): Promise<{ saved: true }> {
    const settings = await this.socialRepository.discoverySettings(userId);
    if (!settings.profileEnabled || !settings.mapEnabled) {
      throw new ForbiddenException("Activa tu perfil social y la visibilidad en el mapa para guardar esta ubicación.");
    }
    const cell = mapCellForLocation(location);
    await this.repository.savePrivateLocation(userId, location, cell.id);
    return { saved: true };
  }

  async areas(_viewerId: string, bounds: MapBounds) {
    const cells = mapCellsForBounds(bounds);
    const counts = await this.repository.listEligibleMapCells(_viewerId, cells);
    const byId = new Map(counts.map((row) => [row.cellId, row.count]));
    return {
      cells: cells.flatMap((cell) => {
        const count = byId.get(cell.id);
        return count ? [{ id: cell.id, center: cell.center, count }] : [];
      }),
    };
  }

  async peopleInCell(viewerId: string, tenantId: string, cellId: string) {
    const [settings, userIds] = await Promise.all([
      this.socialRepository.discoverySettings(viewerId),
      this.repository.listEligibleMapPeople(viewerId, cellId),
    ]);
    if (userIds.length === 0) return [];
    const rows = await this.socialRepository.directory(viewerId, tenantId, env.DEFAULT_TENANT_ID, {
      userIds,
      limit: userIds.length,
      includeCrossGym: settings.profileEnabled && settings.crossGymEnabled,
      mapOnly: true,
      adultOnly: true,
      excludeDecided: true,
    });
    return rows.map(mapDirectoryRowToResponse);
  }

  async gyms(bounds: MapBounds) {
    mapCellsForBounds(bounds);
    return this.repository.listExternalGyms(bounds);
  }

  async cities(query: string) {
    return this.repository.searchCities(query.trim());
  }
}
