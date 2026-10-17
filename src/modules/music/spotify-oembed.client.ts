import { Injectable, Logger } from '@nestjs/common';

/** Lo que nos interesa de oEmbed. Todo opcional: Spotify no garantiza nada. */
export type SpotifyOEmbed = {
  title: string | null;
  thumbnailUrl: string | null;
  /** `https://open.spotify.com/embed/<tipo>/<id>…`; permite resolver enlaces cortos. */
  iframeUrl: string | null;
};

const OEMBED_ENDPOINT = 'https://open.spotify.com/oembed';
const TIMEOUT_MS = 3000;

function optionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

/** Solo portadas por https: el móvil las pinta tal cual. */
function httpsUrl(value: unknown): string | null {
  const candidate = optionalString(value, 1000);
  if (!candidate) return null;
  try {
    return new URL(candidate).protocol === 'https:' ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * oEmbed público de Spotify (sin claves). Nunca lanza: si Spotify tarda más de
 * 3 s, responde mal o no responde, devuelve `null` y la playlist se guarda con
 * el título de respaldo. La URL que recibe ya está normalizada por
 * `parseSpotifyUrl`, así que el host de destino es siempre Spotify.
 */
@Injectable()
export class SpotifyOEmbedClient {
  private readonly logger = new Logger(SpotifyOEmbedClient.name);

  async fetch(normalizedUrl: string): Promise<SpotifyOEmbed | null> {
    const endpoint = `${OEMBED_ENDPOINT}?${new URLSearchParams({ url: normalizedUrl })}`;
    try {
      const res = await fetch(endpoint, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as Record<string, unknown>;
      return {
        title: optionalString(body.title, 500),
        thumbnailUrl: httpsUrl(body.thumbnail_url),
        iframeUrl: httpsUrl(body.iframe_url),
      };
    } catch (error) {
      this.logger.warn({ event: 'music.oembed_failed', reason: (error as Error).message });
      return null;
    }
  }
}
