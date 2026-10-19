import { z } from "zod";

const latitudeSchema = z.coerce.number().finite().min(-85).max(85);
const longitudeSchema = z.coerce.number().finite().min(-180).max(180);

export const updateSocialMapLocationSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
}).strict();

export const socialMapBoundsSchema = z.object({
  south: latitudeSchema,
  west: longitudeSchema,
  north: latitudeSchema,
  east: longitudeSchema,
}).strict().refine((bounds) => bounds.south < bounds.north && bounds.west < bounds.east, {
  message: "El área de búsqueda no es válida.",
});

export const socialMapNearbyQuerySchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
}).strict();

export const socialMapCellIdSchema = z.string().regex(/^\d{1,8}:\d{1,8}$/);
export const socialMapCityQuerySchema = z.object({ q: z.string().trim().min(2).max(80) }).strict();

export type UpdateSocialMapLocationInput = z.infer<typeof updateSocialMapLocationSchema>;
export type SocialMapBoundsInput = z.infer<typeof socialMapBoundsSchema>;
export type SocialMapNearbyQueryInput = z.infer<typeof socialMapNearbyQuerySchema>;
