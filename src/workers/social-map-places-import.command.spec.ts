import { parsePlaces } from "./social-map-places-import.command";

describe("social map place import validation", () => {
  const validPlace = {
    kind: "GYM", source: "OPENSTREETMAP", sourceId: "node/41", name: "Gym Uno",
    address: null, city: null, region: null, latitude: -16.5, longitude: -68.1,
    tags: { amenity: "gym" }, license: "ODbL-1.0", attribution: "© OpenStreetMap contributors",
  };

  it("rejects the null island sentinel before any database write", () => {
    expect(() => parsePlaces(JSON.stringify({ ...validPlace, latitude: 0, longitude: 0 }))).toThrow("line 1");
  });

  it("accepts a named, source-tagged POI with real coordinates", () => {
    expect(parsePlaces(JSON.stringify(validPlace))).toEqual([validPlace]);
  });
});
