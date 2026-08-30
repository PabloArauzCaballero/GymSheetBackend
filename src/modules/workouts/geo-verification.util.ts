import { haversineDistanceMeters } from "../../common/geo/haversine.util";

export type GeoVerifiableBranch = {
  id: string;
  latitude: number;
  longitude: number;
  geofenceRadiusM: number;
};

/**
 * De entre las sedes con coordenadas, la más cercana que efectivamente
 * contiene el punto dado — no la más cercana a secas, porque estar más cerca
 * de una sede fuera de su propio radio no es haber llegado a ella.
 */
export function resolveVerifiedBranch(
  branches: readonly GeoVerifiableBranch[],
  point: { latitude: number; longitude: number },
): GeoVerifiableBranch | null {
  let closest: { branch: GeoVerifiableBranch; distance: number } | null = null;

  for (const branch of branches) {
    const distance = haversineDistanceMeters(point, branch);
    if (distance > branch.geofenceRadiusM) continue;
    if (!closest || distance < closest.distance) closest = { branch, distance };
  }

  return closest?.branch ?? null;
}
