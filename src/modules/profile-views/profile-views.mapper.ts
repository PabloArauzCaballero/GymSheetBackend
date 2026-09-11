import { ProfileViewerRow } from "./profile-views.repository";
import { shortenName } from "../social/social.mapper";

/** Una persona que vio el perfil, tal y como la pinta el cliente. */
export interface ProfileViewerResponse {
  userId: string;
  /** Nombre de pila e inicial: esto no es una lista de socios con nombre completo. */
  displayName: string;
  photoUrl: string | null;
  objetivo: string | null;
  branchName: string | null;
  /** ISO 8601, no `Date`: el contrato del cliente es texto. */
  lastViewedAt: string;
  /** Visitas de esa persona, no de todo el mundo. */
  viewCount: number;
  /** Entró después de la última vez que se abrió la lista. */
  isNew: boolean;
}

export interface ProfileViewersPageResponse {
  viewers: ProfileViewerResponse[];
  nextCursor: string | null;
}

/**
 * `checkedAt` nulo significa que nunca se abrió la lista, y entonces todo es
 * nuevo: no se puede haber visto lo que nunca se miró.
 */
export function mapProfileViewerToResponse(
  row: ProfileViewerRow,
  checkedAt: Date | null,
): ProfileViewerResponse {
  return {
    userId: row.userId,
    displayName: shortenName(row.fullName),
    photoUrl: row.photoUrl,
    objetivo: row.objetivo,
    branchName: row.branchName,
    lastViewedAt: row.lastViewedAt.toISOString(),
    viewCount: row.viewCount,
    isNew: checkedAt === null || row.lastViewedAt.getTime() > checkedAt.getTime(),
  };
}

