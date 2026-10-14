import { ProfileSocialSettingsModel } from "./profile-social-settings.model";
import { SocialMapLocationModel } from "./social-map-location.model";
import { SocialMapPlaceModel } from "./social-map-place.model";
import { SocialMapRepository } from "./social-map.repository";

describe("SocialMapRepository", () => {
  it("returns bounded external gyms with attribution and a stable source identity", async () => {
    const query = jest.fn().mockResolvedValue([{
      kind: "GYM", source: "OPENSTREETMAP", source_id: "node/41", name: "Gym Uno",
      address: null, city: "La Paz", region: "La Paz", latitude: -16.5, longitude: -68.1,
      tags: { amenity: "gym" }, license: "ODbL-1.0", attribution: "© OpenStreetMap contributors",
      imported_at: new Date("2026-10-08T00:00:00.000Z"),
    }]);
    const connection = { query };
    const repository = new SocialMapRepository(
      { sequelize: connection } as unknown as typeof SocialMapLocationModel,
      { sequelize: connection } as unknown as typeof ProfileSocialSettingsModel,
      { sequelize: connection } as unknown as typeof SocialMapPlaceModel,
    );

    await expect(repository.listExternalGyms({ south: -17, west: -69, north: -16, east: -68 })).resolves.toMatchObject([
      { sourceId: "node/41", registered: false, latitude: -16.5, license: "ODbL-1.0" },
    ]);
    const [sql, options] = query.mock.calls[0] as [string, { replacements: Record<string, unknown> }];
    expect(sql).toContain("latitude BETWEEN :south AND :north");
    expect(sql).toContain("social.gym_place_branch_links");
    expect(sql).toContain("LIMIT 200");
    expect(options.replacements).toEqual({ south: -17, west: -69, north: -16, east: -68 });
  });

  it("searches imported settlements without exposing precise user locations", async () => {
    const query = jest.fn().mockResolvedValue([{ source_id: "node/10", name: "La Paz", region: "La Paz", latitude: -16.5, longitude: -68.1 }]);
    const connection = { query };
    const repository = new SocialMapRepository(
      { sequelize: connection } as unknown as typeof SocialMapLocationModel,
      { sequelize: connection } as unknown as typeof ProfileSocialSettingsModel,
      { sequelize: connection } as unknown as typeof SocialMapPlaceModel,
    );

    await expect(repository.searchCities("La Paz")).resolves.toEqual([{
      id: "node/10", name: "La Paz", region: "La Paz", latitude: -16.5, longitude: -68.1, source: "OPENSTREETMAP",
    }]);
    expect(query.mock.calls[0]?.[0]).toContain("kind = 'CITY'");
    expect(query.mock.calls[0]?.[0]).toContain("LIMIT 10");
  });

  it("only aggregates active adults who enabled both social profile and map visibility", async () => {
    const query = jest.fn().mockResolvedValue([{ cell_id: "row:column", people_count: 2 }]);
    const connection = { query };
    const locations = { sequelize: connection } as unknown as typeof SocialMapLocationModel;
    const settings = { sequelize: connection } as unknown as typeof ProfileSocialSettingsModel;
    const places = { sequelize: connection } as unknown as typeof SocialMapPlaceModel;
    const repository = new SocialMapRepository(locations, settings, places);

    await expect(repository.listEligibleMapCells("viewer", [{
      id: "row:column",
      center: { latitude: -16.5, longitude: -68.15 },
    }])).resolves.toEqual([{ cellId: "row:column", count: 2 }]);

    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("settings.profile_enabled = TRUE");
    expect(sql).toContain("settings.map_enabled = TRUE");
    expect(sql).toContain("user_account.estado = 'ACTIVO'");
    expect(sql).toContain("fecha_nacimiento <= CURRENT_DATE - INTERVAL '18 years'");
    expect(sql).not.toMatch(/SELECT\s+location\.latitude/i);
  });

  it("returns only active adults with current map consent from the selected approximate cell", async () => {
    const query = jest.fn().mockResolvedValue([{ user_id: "person-2" }]);
    const connection = { query };
    const locations = { sequelize: connection } as unknown as typeof SocialMapLocationModel;
    const settings = { sequelize: connection } as unknown as typeof ProfileSocialSettingsModel;
    const places = { sequelize: connection } as unknown as typeof SocialMapPlaceModel;
    const repository = new SocialMapRepository(locations, settings, places);

    await expect(repository.listEligibleMapPeople("viewer", "123:456")).resolves.toEqual(["person-2"]);

    const [sql, options] = query.mock.calls[0] as [string, { replacements: Record<string, unknown> }];
    expect(options.replacements).toEqual({ viewerId: "viewer", cellId: "123:456" });
    expect(sql).toContain("social.user_blocks");
    expect(sql).toContain("location.cell_id = :cellId");
    expect(sql).toContain("settings.profile_enabled = TRUE");
    expect(sql).toContain("settings.map_enabled = TRUE");
    expect(sql).toContain("user_account.estado = 'ACTIVO'");
    expect(sql).toContain("LIMIT 30");
    expect(sql).not.toContain("location.latitude");
  });
});
