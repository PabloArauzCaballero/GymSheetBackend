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
