import { BadRequestException } from "@nestjs/common";

export type ExternalPlaceInput = {
  kind: "GYM" | "CITY";
  source: "OPENSTREETMAP";
  sourceId: string;
  name: string;
  address: string | null;
  city: string | null;
  region: string | null;
  latitude: number;
  longitude: number;
  tags: Record<string, string>;
  license: "ODbL-1.0";
  attribution: string;
  updatedAt: string;
};

export type PublicGymPlace = ExternalPlaceInput & { registered: false };

/** Validates an imported external POI before it can become a public map marker. */
export function normalizeExternalPlace(place: ExternalPlaceInput): PublicGymPlace {
  const validCoordinates = Number.isFinite(place.latitude) && Number.isFinite(place.longitude)
    && place.latitude >= -85 && place.latitude <= 85
    && place.longitude >= -180 && place.longitude <= 180
    && !(place.latitude === 0 && place.longitude === 0);
  if (!validCoordinates) throw new BadRequestException("El lugar no tiene coordenadas válidas.");
  if (!place.sourceId || !place.name.trim() || place.source !== "OPENSTREETMAP" || place.license !== "ODbL-1.0"
    || !Number.isFinite(Date.parse(place.updatedAt))) {
    throw new BadRequestException("El lugar externo debe conservar nombre y procedencia verificable.");
  }
  return { ...place, name: place.name.trim(), registered: false };
}
