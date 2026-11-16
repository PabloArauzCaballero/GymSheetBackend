/**
 * Puerto de almacenamiento de media (arquitectura hexagonal / ports & adapters).
 *
 * El dominio depende de esta interfaz, nunca de un proveedor concreto. Los
 * adaptadores (`adapters/*`) implementan el puerto para un backend específico
 * (disco local vía Multer, MinIO/S3, Cloudinary, ...). Seleccionar el proveedor
 * es responsabilidad del factory, gobernado por `MEDIA_STORAGE_PROVIDER`.
 */
import { isSafeStorageKey } from "../../common/media/own-media-key";

/** Token de inyección de dependencias para el proveedor activo. */
export const MEDIA_STORAGE_PROVIDER = Symbol("MEDIA_STORAGE_PROVIDER");

/** Proveedores soportados por el selector de configuración. */
export type MediaStorageProviderName =
  | "local"
  | "minio"
  | "cloudinary"
  | "s3";

/**
 * Carpeta lógica a la que pertenece un binario. Decide el prefijo de la clave
 * y, con él, la visibilidad: `perfiles` es contenido público del directorio del
 * gimnasio, el resto es privado del usuario.
 *
 * `publicaciones` está declarado pero todavía no lo usa nadie: no existe el
 * módulo de publicaciones. Se reserva aquí para que, cuando exista, el layout
 * de claves no tenga que cambiar (y con él, las URLs ya persistidas).
 * `verificaciones` holds person-verification selfies (biometric data): private,
 * encrypted at rest and outside the anonymous MinIO read policy.
 * `reels` tiene una carpeta separada porque sus objetos no están en la política
 * de lectura anónima de MinIO; no se debe guardar contenido de este módulo bajo
 * `publicaciones`.
 */
export type MediaCategory =
  | "perfiles"
  | "stories"
  | "reels"
  | "publicaciones"
  | "chats"
  | "verificaciones"
  | "catalog"
  | "ejercicios";

/**
 * Destino de una carga. Es una unión discriminada a propósito: el compilador
 * exige el `ownerUserId` de las carpetas de usuario y el `conversationId` de
 * los adjuntos de chat, en vez de dejarlos opcionales y confiar en que cada
 * llamada se acuerde.
 *
 * `catalog` es lo administrado (mediateca del gimnasio, dataset espejado de
 * ejercicios): no pertenece a ningún socio, así que no lleva `ownerUserId`.
 */
export type MediaUploadTarget =
  | {
      readonly category: "perfiles" | "stories" | "reels" | "publicaciones" | "verificaciones";
      readonly ownerUserId: string;
    }
  | {
      readonly category: "chats";
      readonly ownerUserId: string;
      readonly conversationId: string;
    }
  | { readonly category: "catalog" }
  /**
   * Demostraciones de un ejercicio del catálogo: una carpeta por ejercicio.
   *
   * No es `catalog` a secas porque aquí el volumen es otro —dos vídeos por
   * ejercicio y más de mil ejercicios— y mezclarlos dejaría miles de objetos
   * planos en la misma carpeta, imposible de revisar o de purgar por ejercicio.
   * El identificador del ejercicio en la clave permite listar, reemplazar y
   * borrar lo de un ejercicio concreto sin consultar la base de datos.
   */
  | { readonly category: "ejercicios"; readonly exerciseId: string };

/** Archivo entrante ya materializado en memoria (forma de Multer memoryStorage). */
export interface MediaUploadInput {
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly buffer: Buffer;
}

/** Resultado de una carga: referencia estable e idempotente al asset. */
export interface StoredAsset {
  /** Nombre del proveedor que almacenó el asset (p. ej. "local", "minio"). */
  readonly provider: MediaStorageProviderName;
  /** Identidad estable dentro del proveedor (clave/objeto/public_id). */
  readonly key: string;
  /** URL pública servible del asset. */
  readonly url: string;
  /** Tamaño en bytes efectivamente almacenado. */
  readonly sizeBytes: number;
  /** SHA-256 del contenido; base de idempotencia por contenido. */
  readonly checksumSha256: string;
  /** true si el asset ya existía con el mismo contenido y se reutilizó. */
  readonly reused: boolean;
}

/**
 * Contrato que todo adaptador de almacenamiento debe cumplir. Las operaciones
 * son idempotentes por contenido: subir dos veces el mismo binario en la misma
 * carpeta no duplica.
 */
export interface MediaStorageProvider {
  readonly name: MediaStorageProviderName;
  /**
   * Whether `remove(key)` really deletes that object (ADR-0017).
   *
   * It is per key, not per provider, because the storage now holds two kinds
   * of content with opposite rules: what people upload (`users/{userId}/…`) is
   * deletable, while the administered catalog (`catalog/`, `ejercicios/`) keeps
   * the immutability of ADR-0010. `MediaRetentionService` asks before removing
   * so it never reports a deletion the adapter is going to skip; consumers that
   * promise deletion (texts, availability checks) ask with a `users/` key.
   */
  canRemove(key: string): boolean;
  upload(
    input: MediaUploadInput,
    target: MediaUploadTarget,
  ): Promise<StoredAsset>;
  /** Reads private bytes for an authenticated application route. */
  download(key: string): Promise<Buffer>;
  /**
   * Deletes the object, or is a logged no-op when `canRemove(key)` is false.
   * A removal the storage rejects (for example AccessDenied) MUST throw: the
   * `media.release` outbox job then retries and dead-letters visibly instead
   * of completing over a file that still exists.
   */
  remove(key: string): Promise<void>;
}

/**
 * Prefijo de carpeta de un destino, sin la barra final ni el nombre de archivo.
 *
 * Vive en el puerto, no en un adaptador, porque el layout de carpetas es una
 * decisión de producto ("las imágenes van ordenadas por perfil de usuario"),
 * no del backend de almacenamiento: `local` y `minio` tienen que producir
 * exactamente la misma estructura para que dev y producción se parezcan y para
 * que migrar entre ellos no reescriba ninguna clave.
 */
/** Root of every key that belongs to a person (`users/{userId}/…`). */
export const USER_CONTENT_KEY_PREFIX = "users/";

/**
 * Whether a storage key is a person's content. The key must be made of plain
 * segments: `users/../catalog/x` is not under `users/`, whatever its prefix says.
 */
export function isUserContentKey(key: string): boolean {
  return key.startsWith(USER_CONTENT_KEY_PREFIX) && isSafeStorageKey(key);
}

export function mediaTargetPrefix(target: MediaUploadTarget): string {
  if (target.category === "catalog") return "catalog";
  if (target.category === "ejercicios") {
    return `ejercicios/${target.exerciseId}`;
  }
  if (target.category === "chats") {
    return `users/${target.ownerUserId}/chats/${target.conversationId}`;
  }
  return `users/${target.ownerUserId}/${target.category}`;
}
