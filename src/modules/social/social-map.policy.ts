import { BadRequestException } from "@nestjs/common";

const MIN_CELL_METERS = 2_000;
const LATITUDE_STEP = MIN_CELL_METERS / 111_320;
const MAX_MAP_LATITUDE = 85;
const MAX_CELLS_PER_QUERY = 100;

export type MapCoordinates = {
  latitude: number;
  longitude: number;
};

export type MapBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type PublicMapCell = {
  id: string;
  center: MapCoordinates;
};

/** Converts private coordinates into a public grid cell of approximately 2 km. */
export function mapCellForLocation(location: MapCoordinates): PublicMapCell {
  validateCoordinates(location);
  const row = Math.floor((location.latitude + 90) / LATITUDE_STEP);
  const centerLatitude = -90 + (row + 0.5) * LATITUDE_STEP;
  const longitudeStep = longitudeStepAt(centerLatitude);
  const column = Math.floor((location.longitude + 180) / longitudeStep);

  return {
    id: `${row}:${column}`,
    center: {
      latitude: roundToThree(centerLatitude),
      longitude: roundToThree(-180 + (column + 0.5) * longitudeStep),
    },
  };
}

/** Returns normalized grid cells and bounds query work to one hundred cells. */
export function mapCellsForBounds(bounds: MapBounds): PublicMapCell[] {
  validateBounds(bounds);
  const cells = new Map<string, PublicMapCell>();
  const firstRow = Math.floor((bounds.south + 90) / LATITUDE_STEP);
  const lastRow = Math.floor((bounds.north + 90) / LATITUDE_STEP);

  for (let row = firstRow; row <= lastRow; row += 1) {
    const centerLatitude = -90 + (row + 0.5) * LATITUDE_STEP;
    const longitudeStep = longitudeStepAt(centerLatitude);
    const firstColumn = Math.floor((bounds.west + 180) / longitudeStep);
    const lastColumn = Math.floor((bounds.east + 180) / longitudeStep);
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const id = `${row}:${column}`;
      cells.set(id, {
        id,
        center: {
          latitude: roundToThree(centerLatitude),
          longitude: roundToThree(-180 + (column + 0.5) * longitudeStep),
        },
      });
      if (cells.size > MAX_CELLS_PER_QUERY) {
        throw new BadRequestException("Acerca el mapa para buscar en un área más pequeña.");
      }
    }
  }

  return [...cells.values()];
}

/**
 * Cells within `ring` cells of a tapped point (ring 2 ≈ 10 km square).
 * The tapped point may be a gym or any place: only cell ids and public
 * centers leave this function, never a stored user coordinate.
 */
export function mapCellsAround(location: MapCoordinates, ring = 2): PublicMapCell[] {
  const origin = mapCellForLocation(location);
  const [originRow] = origin.id.split(":").map(Number);
  const cells: PublicMapCell[] = [];
  for (let row = originRow - ring; row <= originRow + ring; row += 1) {
    const centerLatitude = -90 + (row + 0.5) * LATITUDE_STEP;
    if (Math.abs(centerLatitude) > MAX_MAP_LATITUDE) continue;
    const longitudeStep = longitudeStepAt(centerLatitude);
    const centerColumn = Math.floor((location.longitude + 180) / longitudeStep);
    for (let column = centerColumn - ring; column <= centerColumn + ring; column += 1) {
      cells.push({
        id: `${row}:${column}`,
        center: {
          latitude: roundToThree(centerLatitude),
          longitude: roundToThree(-180 + (column + 0.5) * longitudeStep),
        },
      });
    }
  }
  return cells;
}

/** Distance in km between a point and a public cell center, rounded so it never beats the cell size. */
export function approximateDistanceKm(from: MapCoordinates, cellCenter: MapCoordinates): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(cellCenter.latitude - from.latitude);
  const dLon = toRadians(cellCenter.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(cellCenter.latitude)) * Math.sin(dLon / 2) ** 2;
  const km = 2 * 6_371 * Math.asin(Math.sqrt(a));
  return Math.max(1, Math.round(km));
}

const MAX_GYM_QUERY_DEGREES = 3;

/**
 * Gyms are public places, not people: a whole city (or a department) can be
 * listed at once. Only the box size is bounded; the query caps the rows.
 */
export function validateGymBounds(bounds: MapBounds): void {
  validateBounds(bounds);
  if (bounds.north - bounds.south > MAX_GYM_QUERY_DEGREES || bounds.east - bounds.west > MAX_GYM_QUERY_DEGREES) {
    throw new BadRequestException("Acerca el mapa para ver los gimnasios.");
  }
}

function validateCoordinates(location: MapCoordinates): void {
  if (
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude) ||
    location.latitude < -MAX_MAP_LATITUDE ||
    location.latitude > MAX_MAP_LATITUDE ||
    location.longitude < -180 ||
    location.longitude > 180
  ) {
    throw new BadRequestException("La ubicación está fuera de los límites permitidos.");
  }
}

function validateBounds(bounds: MapBounds): void {
  const valid =
    Object.values(bounds).every(Number.isFinite) &&
    bounds.south >= -MAX_MAP_LATITUDE &&
    bounds.north <= MAX_MAP_LATITUDE &&
    bounds.south < bounds.north &&
    bounds.west >= -180 &&
    bounds.east <= 180 &&
    bounds.west < bounds.east;
  if (!valid) throw new BadRequestException("El área de búsqueda no es válida.");
}

function longitudeStepAt(latitude: number): number {
  const cosine = Math.cos((latitude * Math.PI) / 180);
  return MIN_CELL_METERS / (111_320 * Math.max(cosine, 0.087));
}

function roundToThree(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
