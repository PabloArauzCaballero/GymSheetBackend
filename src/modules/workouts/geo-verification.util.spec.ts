import { resolveVerifiedBranch, type GeoVerifiableBranch } from "./geo-verification.util";

const nearBranch: GeoVerifiableBranch = {
  id: "near",
  latitude: 0,
  longitude: 0,
  geofenceRadiusM: 200,
};

const farBranch: GeoVerifiableBranch = {
  id: "far",
  // ~11.1 km de (0,0): muy por fuera de cualquier radio realista.
  latitude: 0.1,
  longitude: 0,
  geofenceRadiusM: 200,
};

describe("resolveVerifiedBranch", () => {
  it("returns null when no branch is configured", () => {
    expect(resolveVerifiedBranch([], { latitude: 0, longitude: 0 })).toBeNull();
  });

  it("returns the branch when the point falls inside its radius", () => {
    const result = resolveVerifiedBranch([nearBranch], { latitude: 0.0001, longitude: 0 });
    expect(result?.id).toBe("near");
  });

  it("returns null when the point falls outside every radius", () => {
    const result = resolveVerifiedBranch([nearBranch, farBranch], {
      latitude: 0.05,
      longitude: 0,
    });
    expect(result).toBeNull();
  });

  it("picks the closest branch when the point is within more than one radius", () => {
    // A ~1.1 km del punto de prueba, pero con un radio lo bastante grande
    // como para igual cubrirlo — ambas sedes lo contienen, y solo "near" es
    // la más cercana de verdad.
    const wideButFarther: GeoVerifiableBranch = {
      id: "wide-but-farther",
      latitude: 0.01,
      longitude: 0,
      geofenceRadiusM: 20_000,
    };
    const result = resolveVerifiedBranch([wideButFarther, nearBranch], {
      latitude: 0.0001,
      longitude: 0,
    });
    expect(result?.id).toBe("near");
  });
});
