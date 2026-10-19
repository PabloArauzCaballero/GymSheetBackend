import { ForbiddenException, Injectable } from "@nestjs/common";
import { SocialRepository } from "./social.repository";
import { env } from "../../config/env";
import { mapDirectoryRowToResponse } from "./social.mapper";
import { MapBounds, MapCoordinates, approximateDistanceKm, mapCellForLocation, mapCellsAround, mapCellsForBounds, validateGymBounds } from "./social-map.policy";
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

  /**
   * People around a tapped point (a gym or any spot), filtered by the viewer's
   * Conocer preferences and sorted by approximate distance. Distances come from
   * public cell centers, so they never reveal a stored coordinate.
   */
  async nearby(viewerId: string, tenantId: string, point: MapCoordinates) {
    const cells = mapCellsAround(point);
    const centers = new Map(cells.map((cell) => [cell.id, cell.center]));
    const [settings, preferences, located] = await Promise.all([
      this.socialRepository.discoverySettings(viewerId),
      this.socialRepository.discoveryPreferences(viewerId),
      this.repository.listEligibleMapPeopleInCells(viewerId, cells.map((cell) => cell.id)),
    ]);
    const preferencesApplied = preferences.configured;
    if (located.length === 0) return { preferencesApplied, people: [] };
    const rows = await this.socialRepository.directory(viewerId, tenantId, env.DEFAULT_TENANT_ID, {
      userIds: located.map((person) => person.userId),
      limit: located.length,
      includeCrossGym: settings.profileEnabled && settings.crossGymEnabled,
      mapOnly: true,
      adultOnly: true,
      ...(preferences.configured
        ? { genders: preferences.genders, minAge: preferences.minAge, maxAge: preferences.maxAge }
        : {}),
    });
    const cellByUser = new Map(located.map((person) => [person.userId, person.cellId]));
    const people = rows.map((row) => {
      const center = centers.get(cellByUser.get(row.userId) ?? "");
      return { ...mapDirectoryRowToResponse(row), distanceKm: center ? approximateDistanceKm(point, center) : null };
    });
    people.sort((a, b) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99) || a.displayName.localeCompare(b.displayName));
    return { preferencesApplied, people };
  }

  async gyms(bounds: MapBounds) {
    validateGymBounds(bounds);
    return this.repository.listExternalGyms(bounds);
  }

  async cities(query: string) {
    return this.repository.searchCities(query.trim());
  }
}
