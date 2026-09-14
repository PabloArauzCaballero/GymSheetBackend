import { LocalStorageAdapter } from "./adapters/local-storage.adapter";
import { MinioStorageAdapter } from "./adapters/minio-storage.adapter";
import {
  MediaStorageProvider,
  MediaStorageProviderName,
} from "./media-storage.port";

/** Credenciales y destino del adaptador MinIO; sólo se exigen si es el activo. */
export interface MinioConnectionConfig {
  readonly endPoint?: string;
  readonly port?: number;
  readonly useSSL?: boolean;
  readonly accessKey?: string;
  readonly secretKey?: string;
  readonly bucket?: string;
  readonly region?: string;
}

export interface MediaStorageConfig {
  readonly provider: MediaStorageProviderName;
  readonly localRoot: string;
  readonly publicBaseUrl: string;
  readonly minio?: MinioConnectionConfig;
}

/**
 * Selecciona el adaptador de almacenamiento según la configuración. No hay
 * fallback silencioso: un proveedor solicitado pero no implementado/configurado
 * detiene el arranque con un error explícito (regla anti-fabricación).
 *
 * Añadir un proveedor nuevo (Cloudinary, S3) se reduce a implementar el puerto
 * `MediaStorageProvider` y registrar su caso aquí.
 */
export function createMediaStorageProvider(
  config: MediaStorageConfig,
): MediaStorageProvider {
  switch (config.provider) {
    case "local":
      return new LocalStorageAdapter({
        root: config.localRoot,
        publicBaseUrl: config.publicBaseUrl,
      });
    case "minio": {
      const minio = config.minio ?? {};
      // Fallar aquí y no dentro del adaptador: sin credenciales, el proceso no
      // debe arrancar sirviendo subidas que van a reventar una a una.
      const missing = (
        ["endPoint", "accessKey", "secretKey", "bucket"] as const
      ).filter((field) => !minio[field]);
      if (missing.length > 0) {
        throw new Error(
          "El proveedor de media 'minio' requiere " +
            `${missing.map((field) => `MINIO_${field.toUpperCase()}`).join(", ")}. ` +
            "Configúralas o usa MEDIA_STORAGE_PROVIDER=local.",
        );
      }
      return new MinioStorageAdapter({
        endPoint: minio.endPoint as string,
        port: minio.port ?? 9000,
        useSSL: minio.useSSL ?? false,
        accessKey: minio.accessKey as string,
        secretKey: minio.secretKey as string,
        bucket: minio.bucket as string,
        region: minio.region ?? "us-east-1",
        publicBaseUrl: config.publicBaseUrl,
      });
    }
    case "cloudinary":
      throw new Error(
        "El proveedor de media 'cloudinary' aún no está implementado. " +
          "Implementa un CloudinaryAdapter que cumpla MediaStorageProvider y " +
          "regístralo en createMediaStorageProvider, o usa MEDIA_STORAGE_PROVIDER=local.",
      );
    case "s3":
      throw new Error(
        "El proveedor de media 's3' aún no está implementado. Para un almacén " +
          "S3-compatible auto-hospedado usa MEDIA_STORAGE_PROVIDER=minio; para " +
          "S3 de AWS, implementa un S3Adapter y regístralo aquí.",
      );
    default: {
      const exhaustiveCheck: never = config.provider;
      throw new Error(
        `Proveedor de media desconocido: ${String(exhaustiveCheck)}.`,
      );
    }
  }
}
