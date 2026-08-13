/**
 * Puerto de almacenamiento de media (arquitectura hexagonal / ports & adapters).
 *
 * El dominio depende de esta interfaz, nunca de un proveedor concreto. Los
 * adaptadores (`adapters/*`) implementan el puerto para un backend específico
 * (disco local vía Multer, Cloudinary, S3-compatible, ...). Seleccionar el
 * proveedor es responsabilidad del factory, gobernado por `MEDIA_STORAGE_PROVIDER`.
 */

/** Token de inyección de dependencias para el proveedor activo. */
export const MEDIA_STORAGE_PROVIDER = Symbol("MEDIA_STORAGE_PROVIDER");

/** Proveedores soportados por el selector de configuración. */
export type MediaStorageProviderName = "local" | "cloudinary" | "s3";

/** Archivo entrante ya materializado en memoria (forma de Multer memoryStorage). */
export interface MediaUploadInput {
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly buffer: Buffer;
}

/** Resultado de una carga: referencia estable e idempotente al asset. */
export interface StoredAsset {
  /** Nombre del proveedor que almacenó el asset (p. ej. "local", "cloudinary"). */
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
 * son idempotentes por contenido: subir dos veces el mismo binario no duplica.
 */
export interface MediaStorageProvider {
  readonly name: MediaStorageProviderName;
  upload(input: MediaUploadInput): Promise<StoredAsset>;
  remove(key: string): Promise<void>;
}
