import { BadRequestException } from "@nestjs/common";
import { mapCellForLocation, mapCellsForBounds } from "./social-map.policy";
import { normalizeExternalPlace } from "./gym-places.policy";

describe("social map grid privacy", () => {
  it("maps people to an approximate cell without returning their coordinates", () => {
    const cell = mapCellForLocation({ latitude: -16.5, longitude: -68.15 });

    expect(cell).toEqual(expect.objectContaining({ id: expect.any(String) }));
    expect(cell.center.latitude).not.toBe(-16.5);
    expect(cell.center.longitude).not.toBe(-68.15);
    expect(cell).not.toHaveProperty("latitude");
    expect(cell).not.toHaveProperty("longitude");
  });

  it("rejects invalid coordinates and locations outside supported map latitudes", () => {
    expect(() => mapCellForLocation({ latitude: 91, longitude: 0 })).toThrow(BadRequestException);
    expect(() => mapCellForLocation({ latitude: 0, longitude: 181 })).toThrow(BadRequestException);
    expect(() => mapCellForLocation({ latitude: 86, longitude: 0 })).toThrow(BadRequestException);
  });

  it("rejects a search covering more than one hundred approximate cells", () => {
    expect(() => mapCellsForBounds({ south: -16.6, west: -68.3, north: -16.4, east: -68.0 }))
      .toThrow(BadRequestException);
  });

  it("returns a bounded set of privacy cells for a small area", () => {
    const cells = mapCellsForBounds({ south: -16.51, west: -68.16, north: -16.49, east: -68.14 });

    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThanOrEqual(100);
    expect(new Set(cells.map((cell) => cell.id)).size).toBe(cells.length);
  });
});

describe("external gym place policy", () => {
  it("keeps OSM provenance and rejects invalid coordinates instead of pinning zero", () => {
    expect(normalizeExternalPlace({
      kind: "GYM", source: "OPENSTREETMAP", sourceId: "node/41", name: "Gym Uno",
      address: null, city: "La Paz", region: "La Paz", latitude: -16.5, longitude: -68.1,
      tags: { amenity: "gym" }, license: "ODbL-1.0", attribution: "© OpenStreetMap contributors",
      updatedAt: "2026-10-08T00:00:00.000Z",
    })).toMatchObject({ sourceId: "node/41", registered: false, latitude: -16.5, longitude: -68.1 });

    expect(() => normalizeExternalPlace({
      kind: "GYM", source: "OPENSTREETMAP", sourceId: "node/42", name: "Bad Gym",
      address: null, city: null, region: null, latitude: 0, longitude: 0,
      tags: {}, license: "ODbL-1.0", attribution: "© OpenStreetMap contributors",
      updatedAt: "2026-10-08T00:00:00.000Z",
    })).toThrow("coordenadas");
  });
});
