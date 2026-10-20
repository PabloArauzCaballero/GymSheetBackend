import { ProfilePhotoModel } from "./profile-photo.model";
import { resolveMediaUrl } from "../../common/media/media-url";

export type ProfilePhotoResponse = {
  id: string;
  url: string;
  posicion: number;
  fechaCreacion: Date;
};

export function mapProfilePhotoToResponse(photo: ProfilePhotoModel): ProfilePhotoResponse {
  return {
    id: photo.id,
    url: resolveMediaUrl(photo.url) ?? photo.url,
    posicion: photo.position,
    fechaCreacion: photo.createdAt,
  };
}
