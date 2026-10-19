import { ForbiddenException } from "@nestjs/common";
import { mapCellForLocation, mapCellsAround, mapCellsForBounds } from "./social-map.policy";
import { SocialMapService } from "./social-map.service";

describe("SocialMapService", () => {
  const bounds = { south: -16.51, west: -68.16, north: -16.49, east: -68.14 };

  it("does not store an exact map location until the profile and map are both enabled", async () => {
    const repository = { savePrivateLocation: jest.fn(), listEligibleMapCells: jest.fn() };
    const settings = { discoverySettings: jest.fn().mockResolvedValue({ profileEnabled: true, mapEnabled: false }) };
    const service = new SocialMapService(repository as never, settings as never);

    await expect(service.setLocation("viewer", { latitude: -16.5, longitude: -68.15 }))
      .rejects.toThrow(ForbiddenException);
    expect(repository.savePrivateLocation).not.toHaveBeenCalled();
  });

  it("returns only approximate cell centers and counts from the repository", async () => {
    const repository = {
      savePrivateLocation: jest.fn(),
      listEligibleMapCells: jest.fn(async (_viewerId: string, cells: { id: string }[]) => [{ cellId: cells[0].id, count: 3 }]),
    };
    const settings = { discoverySettings: jest.fn() };
    const service = new SocialMapService(repository as never, settings as never);

    const result = await service.areas("viewer", bounds);

    expect(repository.listEligibleMapCells).toHaveBeenCalledWith("viewer", expect.any(Array));
    expect(result).toEqual({
      cells: [{ id: mapCellsForBounds(bounds)[0].id, count: 3, center: expect.objectContaining({ latitude: expect.any(Number), longitude: expect.any(Number) }) }],
    });
    expect(JSON.stringify(result)).not.toContain("viewer");
  });

  it("lists only opted-in people in the selected cell through the shared directory policy", async () => {
    const mapRepository = {
      savePrivateLocation: jest.fn(),
      listEligibleMapCells: jest.fn(),
      listEligibleMapPeople: jest.fn().mockResolvedValue(["person-2"]),
    };
    const directory = jest.fn().mockResolvedValue([{
      userId: "person-2",
      fullName: "María López",
      objetivo: null,
      branchId: null,
      branchName: null,
      connectionStatus: "NONE",
      connectionId: null,
      socialStatus: null,
      photoUrl: null,
      photos: [],
      age: 29,
      gender: null,
      experienceLevel: null,
      points: null,
      levelCode: null,
    }]);
    const socialRepository = {
      discoverySettings: jest.fn().mockResolvedValue({
        profileEnabled: true, crossGymEnabled: true, mapEnabled: false, version: 2,
      }),
      directory,
    };
    const service = new SocialMapService(mapRepository as never, socialRepository as never);

    await expect(service.peopleInCell("viewer", "tenant-a", "row:column")).resolves.toMatchObject([
      { userId: "person-2", displayName: "María L." },
    ]);
    expect(mapRepository.listEligibleMapPeople).toHaveBeenCalledWith("viewer", "row:column");
    expect(directory).toHaveBeenCalledWith("viewer", "tenant-a", expect.any(String), expect.objectContaining({
      userIds: ["person-2"],
      includeCrossGym: true,
      mapOnly: true,
      adultOnly: true,
      excludeDecided: true,
    }));
  });

  it("lists people around a tapped gym with the viewer's Conocer preferences, nearest first", async () => {
    const gym = { latitude: -16.5, longitude: -68.15 };
    const here = mapCellForLocation(gym).id;
    const far = mapCellsAround(gym)[0].id;
    const row = (userId: string, fullName: string) => ({
      userId, fullName, objetivo: null, branchId: null, branchName: null, connectionStatus: "NONE",
      connectionId: null, socialStatus: null, photoUrl: null, photos: [], age: 30, gender: "FEMALE",
      experienceLevel: null, points: null, levelCode: null,
    });
    const mapRepository = {
      listEligibleMapPeopleInCells: jest.fn().mockResolvedValue([
        { userId: "far", cellId: far }, { userId: "near", cellId: here },
      ]),
    };
    const directory = jest.fn().mockResolvedValue([row("far", "Ana Far"), row("near", "Bea Near")]);
    const socialRepository = {
      discoverySettings: jest.fn().mockResolvedValue({ profileEnabled: true, crossGymEnabled: false }),
      discoveryPreferences: jest.fn().mockResolvedValue({
        configured: true, genders: ["FEMALE"], minAge: 25, maxAge: 35, intents: [], radiusKm: 10,
        flexibleAge: false, flexibleDistance: false, version: 1,
      }),
      directory,
    };
    const service = new SocialMapService(mapRepository as never, socialRepository as never);

    const result = await service.nearby("viewer", "tenant-a", gym);

    expect(result.preferencesApplied).toBe(true);
    expect(result.people.map((person) => person.userId)).toEqual(["near", "far"]);
    expect(result.people[0].distanceKm).toBe(1);
    expect(result.people[1].distanceKm).toBeGreaterThan(1);
    expect(directory).toHaveBeenCalledWith("viewer", "tenant-a", expect.any(String), expect.objectContaining({
      userIds: ["far", "near"], genders: ["FEMALE"], minAge: 25, maxAge: 35, mapOnly: true, adultOnly: true,
    }));
  });

  it("returns no people and skips the directory when nobody shares a location nearby", async () => {
    const mapRepository = { listEligibleMapPeopleInCells: jest.fn().mockResolvedValue([]) };
    const socialRepository = {
      discoverySettings: jest.fn().mockResolvedValue({ profileEnabled: true, crossGymEnabled: false }),
      discoveryPreferences: jest.fn().mockResolvedValue({ configured: false, version: 0 }),
      directory: jest.fn(),
    };
    const service = new SocialMapService(mapRepository as never, socialRepository as never);

    await expect(service.nearby("viewer", "tenant-a", { latitude: -16.5, longitude: -68.15 }))
      .resolves.toEqual({ preferencesApplied: false, people: [] });
    expect(socialRepository.directory).not.toHaveBeenCalled();
  });

  it("lists gyms for a whole city but refuses a box wider than three degrees", async () => {
    const mapRepository = { listExternalGyms: jest.fn().mockResolvedValue([]) };
    const service = new SocialMapService(mapRepository as never, {} as never);
    const laPaz = { south: -16.75, west: -68.35, north: -16.25, east: -67.85 };

    await expect(service.gyms(laPaz)).resolves.toEqual([]);
    expect(mapRepository.listExternalGyms).toHaveBeenCalledWith(laPaz);
    await expect(service.gyms({ south: -22, west: -69, north: -10, east: -58 })).rejects.toThrow("Acerca el mapa");
  });
});
