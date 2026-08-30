import { haversineDistanceMeters } from "./haversine.util";

describe("haversineDistanceMeters", () => {
  it("returns zero for the same point", () => {
    const point = { latitude: -17.783, longitude: -63.182 };
    expect(haversineDistanceMeters(point, point)).toBe(0);
  });

  it("matches the arc-length formula for two points on the equator", () => {
    // En el ecuador, la distancia a lo largo del círculo máximo es exactamente
    // radio × ángulo (en radianes) — no depende de la fórmula del haversine
    // para verificarse, así que sirve como referencia independiente.
    const a = { latitude: 0, longitude: 0 };
    const b = { latitude: 0, longitude: 1 };
    const expected = 6_371_000 * (Math.PI / 180);
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(expected, 0);
  });

  it("is symmetric", () => {
    const a = { latitude: 10, longitude: 20 };
    const b = { latitude: 10.01, longitude: 20.01 };
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 6);
  });
});
