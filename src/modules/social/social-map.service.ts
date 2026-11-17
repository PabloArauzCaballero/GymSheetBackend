import { ForbiddenException, HttpStatus, Injectable } from "@nestjs/common";
import { DomainException } from "../../common/errors/domain.exception";
import { ConsentsService } from "../consents/consents.service";
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
    private readonly consents: ConsentsService,
  ) {}

  async setLocation(userId: string, location: MapCoordinates): Promise<{ saved: true }> {
    const settings = await this.socialRepository.discoverySettings(userId);
    if (!settings.profileEnabled || !settings.mapEnabled) {
      throw new ForbiddenException("Activa tu perfil social y la visibilidad en el mapa para guardar esta ubicación.");
    }
    const cell = mapCellForLocation(location);
    // Precise location needs its own consent; the share lock makes a concurrent revocation erase this write.
    await this.repository.runInTransaction(async (transaction) => {
      await this.consents.assertGranted(userId, "PRECISE_LOCATION", transaction);
      await this.repository.savePrivateLocation(userId, location, cell.id, transaction);
    });
    return { saved: true };
  }

  /**
   * "If you don't share, you don't see": only a viewer whose own social profile
   * and map visibility are on may see who is on the map. Checked before any
   * map query, so a refused viewer learns nothing (not even a count).
   */
  private async assertViewerShares(viewerId: string) {
    const settings = await this.socialRepository.discoverySettings(viewerId);
    if (!settings.profileEnabled || !settings.mapEnabled) {
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        "SOCIAL_MAP_DISABLED",
        "Para ver a otras personas en el mapa, activa tu perfil social y tu visibilidad en el mapa.",
      );
    }
    return settings;
  }

  async areas(viewerId: string, bounds: MapBounds) {
    const cells = mapCellsForBounds(bounds);
    await this.assertViewerShares(viewerId);
    const counts = await this.repository.listEligibleMapCells(viewerId, cells);
    const byId = new Map(counts.map((row) => [row.cellId, row.count]));
    return {
      cells: cells.flatMap((cell) => {
        const count = byId.get(cell.id);
        return count ? [{ id: cell.id, center: cell.center, count }] : [];
      }),
    };
  }

  async peopleInCell(viewerId: string, tenantId: string, cellId: string) {
    const settings = await this.assertViewerShares(viewerId);
    const userIds = await this.repository.listEligibleMapPeople(viewerId, cellId);
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
    const settings = await this.assertViewerShares(viewerId);
    const [preferences, located] = await Promise.all([
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
