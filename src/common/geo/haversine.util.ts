/** Radio medio de la Tierra, en metros. */
const EARTH_RADIUS_M = 6_371_000;

/**
 * Distancia entre dos coordenadas, en metros.
 *
 * Suficiente para verificar si alguien está dentro del radio de una sede: a
 * esa escala (decenas o cientos de metros) el error de asumir una Tierra
 * esférica en vez de un elipsoide es despreciable, y evita traer una
 * dependencia geoespacial para un solo cálculo.
 */
export function haversineDistanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLng = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_M * c;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
