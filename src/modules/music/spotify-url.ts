/**
 * Reconocimiento y normalización de enlaces de Spotify, como funciones puras.
 *
 * Solo se aceptan dos hosts y siempre por https: es a la vez la regla de
 * producto (solo Spotify) y la allowlist que impide que la llamada a oEmbed se
 * convierta en un SSRF — oEmbed siempre recibe una URL construida aquí, nunca
 * la que mandó el cliente.
 */

export const SPOTIFY_CONTENT_TYPES = ['playlist', 'album', 'track', 'artist', 'show'] as const;
export type SpotifyContentType = (typeof SPOTIFY_CONTENT_TYPES)[number];

export type ParsedSpotifyUrl = {
  /** `https://open.spotify.com/<tipo>/<id>` o, si no hay id, `https://spotify.link/<código>`. */
  url: string;
  tipo: SpotifyContentType;
  /** Nulo en los enlaces cortos: el id solo se conoce si oEmbed lo resuelve. */
  id: string | null;
};

const OPEN_HOST = 'open.spotify.com';
const SHORT_HOST = 'spotify.link';
const MAX_INPUT_LENGTH = 500;

/** Los ids de Spotify son base62 de 22 caracteres. */
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
/** Prefijo regional que Spotify mete en los enlaces compartidos: `intl-es`, `intl-pt-br`… */
const INTL_PREFIX = /^intl-[a-z]{2}(?:-[a-z]{2})?$/i;
const SHORT_CODE = /^[A-Za-z0-9_-]{1,64}$/;

function isContentType(value: string): value is SpotifyContentType {
  return (SPOTIFY_CONTENT_TYPES as readonly string[]).includes(value);
}

export function canonicalSpotifyUrl(tipo: SpotifyContentType, id: string): string {
  return `https://${OPEN_HOST}/${tipo}/${id}`;
}

/** `<tipo>/<id>` tras quitar los prefijos admitidos (`intl-xx`, `embed`, `user/<nombre>`). */
function parseOpenPath(segments: string[]): ParsedSpotifyUrl | null {
  let rest = segments;
  if (rest[0] && INTL_PREFIX.test(rest[0])) rest = rest.slice(1);
  if (rest[0] === 'embed') rest = rest.slice(1);
  // Formato antiguo de playlists: /user/<nombre>/playlist/<id>.
  if (rest[0] === 'user' && rest.length === 4) rest = rest.slice(2);
  if (rest.length !== 2) return null;
  const [tipo, id] = rest;
  if (!isContentType(tipo) || !SPOTIFY_ID.test(id)) return null;
  return { url: canonicalSpotifyUrl(tipo, id), tipo, id };
}

/**
 * Devuelve el enlace normalizado o `null` si no es un enlace de Spotify admitido.
 * La query (`?si=…`) y el fragmento se descartan siempre.
 */
export function parseSpotifyUrl(raw: string): ParsedSpotifyUrl | null {
  const input = raw.trim();
  if (input.length === 0 || input.length > MAX_INPUT_LENGTH) return null;
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
  const host = parsed.hostname.toLowerCase();

  if (host === OPEN_HOST) return parseOpenPath(segments);
  if (host === SHORT_HOST) {
    if (segments.length !== 1 || !SHORT_CODE.test(segments[0])) return null;
    return { url: `https://${SHORT_HOST}/${segments[0]}`, tipo: 'playlist', id: null };
  }
  return null;
}

/**
 * Lee `<tipo>/<id>` del `iframe_url` que devuelve oEmbed
 * (`https://open.spotify.com/embed/playlist/<id>?…`). Sirve para resolver un
 * enlace corto cuando Spotify lo expande; si no se puede, `null`.
 */
export function parseSpotifyEmbedUrl(raw: unknown): ParsedSpotifyUrl | null {
  if (typeof raw !== 'string') return null;
  const parsed = parseSpotifyUrl(raw);
  return parsed && parsed.id ? parsed : null;
}
