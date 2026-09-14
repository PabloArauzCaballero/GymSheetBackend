/**
 * Puerto de almacenamiento de media (arquitectura hexagonal / ports & adapters).
 *
 * El dominio depende de esta interfaz, nunca de un proveedor concreto. Los
 * adaptadores (`adapters/*`) implementan el puerto para un backend específico
 * (disco local vía Multer, MinIO/S3, Cloudinary, ...). Seleccionar el proveedor
 * es responsabilidad del factory, gobernado por `MEDIA_STORAGE_PROVIDER`.
 */

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
 */
export type MediaCategory =
  | "perfiles"
  | "stories"
  | "publicaciones"
  | "chats"
  | "catalog";

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
      readonly category: "perfiles" | "stories" | "publicaciones";
      readonly ownerUserId: string;
    }
  | {
      readonly category: "chats";
      readonly ownerUserId: string;
      readonly conversationId: string;
    }
  | { readonly category: "catalog" };

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
   * `true` si el proveedor CONSERVA los binarios para siempre y su `remove` no
   * borra nada.
   *
   * No es un detalle del adaptador: cambia lo que `MediaRetentionService` puede
   * prometer. Con un proveedor inmutable la fila se borra igual (la story
   * caduca, la foto sale de la galería) pero el objeto sigue existiendo, y el
   * servicio tiene que decirlo en su log y en su resultado en vez de anunciar
   * un borrado que no ocurrió.
   */
  readonly immutable: boolean;
  upload(
    input: MediaUploadInput,
    target: MediaUploadTarget,
  ): Promise<StoredAsset>;
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
export function mediaTargetPrefix(target: MediaUploadTarget): string {
  if (target.category === "catalog") return "catalog";
  if (target.category === "chats") {
    return `users/${target.ownerUserId}/chats/${target.conversationId}`;
  }
  return `users/${target.ownerUserId}/${target.category}`;
}
