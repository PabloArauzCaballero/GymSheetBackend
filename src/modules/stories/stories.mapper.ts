import { StoryFeedRow, StoryViewerRow } from "./stories.repository";
import { StoryModel, StoryMediaType } from "./story.model";

export type StoryResponse = {
  id: string;
  mediaUrl: string;
  mediaType: StoryMediaType;
  createdAt: Date;
  expiresAt: Date;
};

export function mapStoryToResponse(story: StoryModel): StoryResponse {
  return {
    id: story.id,
    mediaUrl: story.mediaUrl,
    mediaType: story.mediaType,
    createdAt: story.createdAt,
    expiresAt: story.expiresAt,
  };
}

export type StoryFeedEntryResponse = {
  userId: string;
  fullName: string;
  photoUrl: string | null;
  hasUnviewed: boolean;
  stories: {
    id: string;
    mediaUrl: string;
    mediaType: StoryMediaType;
    /** ISO 8601 — el contrato del frontend espera texto, no un `Date` serializado por el transporte. */
    createdAt: string;
    viewedByMe: boolean;
  }[];
};

/**
 * Agrupa filas planas (una por story) en una entrada por usuario — el feed se
 * recorre por persona, no por story suelta.
 *
 * No reordena nada: el orden de personas es el que impone el `ORDER BY` del
 * repositorio (propias → con contenido sin ver → story más reciente). Funciona
 * porque `Map` conserva el orden de inserción y porque el SQL desempata por
 * `s.user_id`, de modo que todas las filas de una persona llegan seguidas: la
 * primera fila de cada persona fija su posición y ninguna posterior la mueve.
 */
export function mapFeedRowsToResponse(rows: StoryFeedRow[]): StoryFeedEntryResponse[] {
  const byUser = new Map<string, StoryFeedEntryResponse>();
  for (const row of rows) {
    let entry = byUser.get(row.user_id);
    if (!entry) {
      entry = { userId: row.user_id, fullName: row.full_name, photoUrl: row.photo_url, hasUnviewed: false, stories: [] };
      byUser.set(row.user_id, entry);
    }
    entry.stories.push({
      id: row.id,
      mediaUrl: row.media_url,
      mediaType: row.media_type,
      // `new Date(...).toISOString()` y no una copia tal cual: el driver devuelve
      // `Date` para `timestamptz`, así que copiarlo a un campo declarado `string`
      // mentía en el tipo y rompía cualquier `.slice()`/`.startsWith()` río abajo.
      // Mismo criterio que ya se aplicó en el camino de espectadores.
      createdAt: new Date(row.created_at).toISOString(),
      viewedByMe: row.viewed_by_me,
    });
    if (!row.viewed_by_me) entry.hasUnviewed = true;
  }
  return Array.from(byUser.values());
}

export type StoryViewerResponse = {
  userId: string;
  fullName: string;
  photoUrl: string | null;
  /** ISO 8601 — el contrato del frontend espera texto, no un `Date` serializado por el transporte. */
  viewedAt: string;
};

export type StoryViewersResponse = {
  storyId: string;
  total: number;
  viewers: StoryViewerResponse[];
};

/** Espectadores de una story propia, en el orden (viewed_at DESC) que fija la consulta. */
export function mapStoryViewersToResponse(
  storyId: string,
  rows: StoryViewerRow[],
): StoryViewersResponse {
  return {
    storyId,
    total: rows.length,
    viewers: rows.map((row) => ({
      userId: row.user_id,
      fullName: row.full_name,
      photoUrl: row.photo_url,
      // `new Date(...)` y no `row.viewed_at.toISOString()`: el driver devuelve
      // `Date` para timestamptz, pero normalizar aquí evita que un cambio de
      // driver o un mock con texto rompa el contrato en producción.
      viewedAt: new Date(row.viewed_at).toISOString(),
    })),
  };
}
