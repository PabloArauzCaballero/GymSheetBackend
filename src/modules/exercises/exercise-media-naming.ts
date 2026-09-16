import type { ExerciseMediaVariant } from "./exercises.schemas";

/**
 * Nombres canónicos de las demostraciones de ejercicio (§5 del plan de vídeos).
 *
 * Todo lo de aquí es puro y sin dependencias del framework a propósito: son las
 * reglas que deciden si un reintento de carga crea una fila nueva o reutiliza la
 * que ya había, y esa decisión tiene que poder probarse sin base de datos ni
 * almacenamiento.
 */

/**
 * Formato en la identidad natural del asset. Sale del MIME ya validado, nunca
 * del nombre del archivo: quien elige el nombre no debe poder elegir la
 * identidad de la fila.
 */
const FORMAT_BY_MIME: Readonly<Record<string, string>> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
};

export function mediaFormatForMime(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  const known = FORMAT_BY_MIME[normalized];
  if (known) return known;
  // Un MIME admitido pero sin formato declarado aquí no debe romper la carga;
  // se degrada al subtipo saneado, que sigue siendo estable y comparable.
  const subtype = normalized.split("/")[1] ?? "bin";
  return subtype.replace(/[^a-z0-9]/g, "") || "bin";
}

/** Etiqueta de la variante tal como se lee en un texto en español. */
const VARIANT_LABEL: Readonly<Record<ExerciseMediaVariant, string>> = {
  HOMBRE: "hombre",
  MUJER: "mujer",
  NEUTRO: "neutra",
};

export function variantLabel(variant: ExerciseMediaVariant): string {
  return VARIANT_LABEL[variant];
}

/** Límite de la columna `external_id` en `training.exercise_media`. */
const EXTERNAL_ID_MAX_LENGTH = 180;

/**
 * Identidad natural de una pieza: `gymsheet:<ejercicio>:<variante>:<formato>:v<versión>`.
 *
 * Es lo que hace idempotente un reintento a nivel de fila. La clave del objeto
 * en el almacén es el SHA-256 del contenido, así que dos renders distintos del
 * mismo plano producen claves distintas; sin esta identidad, cada reintento con
 * un archivo recodificado dejaría una fila huérfana más.
 */
export function buildExerciseMediaExternalId(params: {
  exerciseId: string;
  variant: ExerciseMediaVariant;
  mimeType: string;
  renderVersion: number;
}): string {
  const { exerciseId, variant, mimeType, renderVersion } = params;
  const identity = [
    "gymsheet",
    exerciseId,
    variant.toLowerCase(),
    mediaFormatForMime(mimeType),
    `v${renderVersion}`,
  ].join(":");
  return identity.slice(0, EXTERNAL_ID_MAX_LENGTH);
}

/** Límite de la columna `alt_text`, que el esquema ya valida. */
const ALT_TEXT_MAX_LENGTH = 500;

/**
 * Texto alternativo a partir del propio catálogo.
 *
 * Los campos que faltan se omiten en vez de rellenarse con un valor inventado:
 * «Demostración de X con null» sería peor que una frase más corta, y quien usa
 * lector de pantalla es justo quien menos margen tiene para adivinar.
 */
export function buildExerciseMediaAltText(params: {
  name: string;
  requiredEquipment?: string | null;
  targetMuscle?: string | null;
  variant: ExerciseMediaVariant;
}): string {
  const { name, requiredEquipment, targetMuscle, variant } = params;
  const equipment = requiredEquipment?.trim();
  const target = targetMuscle?.trim();

  const head = equipment
    ? `Demostración de ${name} con ${equipment}`
    : `Demostración de ${name}`;
  const sentences = [`${head}, versión ${variantLabel(variant)}.`];
  if (target) sentences.push(`Trabaja ${target}.`);

  return sentences.join(" ").slice(0, ALT_TEXT_MAX_LENGTH);
}

/**
 * Réplica EXACTA de la restricción `ck_exercise_media_https` de
 * `training.exercise_media`, tras la migración `202609160003-exercise-media-plain-http`:
 *
 * ```sql
 * CHECK (url ~ '^https://' OR url ~ '^http://')
 * ```
 *
 * Se replica aquí porque el orden de las operaciones importa: primero se
 * escribe el binario en el almacén y después la fila. Si la URL viola la
 * restricción, el INSERT revienta con un 500 opaco y el objeto queda **huérfano
 * para siempre**, porque el almacén es inmutable (ADR-0010). Comprobarlo antes
 * convierte una corrupción silenciosa en un error de configuración visible.
 *
 * Qué sigue rechazando: cualquier esquema que no sea http o https —`file:`,
 * `javascript:`, `data:`— y las rutas relativas. Lo que ya no impone es el
 * cifrado: el almacén propio de los entornos sin certificado se publica por http
 * plano, y exigir https ahí solo producía objetos huérfanos. Donde haya TLS, la
 * URL sale https sola, porque la construye `MEDIA_STORAGE_PUBLIC_BASE_URL`.
 */
const STORABLE_URL_PATTERNS: readonly RegExp[] = [/^https:\/\//, /^http:\/\//];

export function isStorableMediaUrl(url: string): boolean {
  return STORABLE_URL_PATTERNS.some((pattern) => pattern.test(url));
}

/**
 * ¿La URL apunta a NUESTRO almacenamiento?
 *
 * El póster viaja como URL, no como archivo, así que sin esta comprobación
 * cualquiera con permiso de gestión podría colgar de una fila propia la
 * miniatura de un servidor ajeno: la app la pediría en cada listado y ese
 * tercero vería el tráfico de los socios. Se compara origen y prefijo de ruta,
 * no solo el dominio, porque la base pública puede vivir en un subcamino
 * (`https://cdn.example/media`).
 */
export function isOwnStorageUrl(
  candidateUrl: string,
  publicBaseUrl: string,
): boolean {
  let candidate: URL;
  let base: URL;
  try {
    candidate = new URL(candidateUrl);
    base = new URL(publicBaseUrl);
  } catch {
    return false;
  }
  if (candidate.origin !== base.origin) return false;

  const basePath = base.pathname.replace(/\/+$/, "");
  if (basePath === "") return true;
  return (
    candidate.pathname === basePath ||
    candidate.pathname.startsWith(`${basePath}/`)
  );
}
