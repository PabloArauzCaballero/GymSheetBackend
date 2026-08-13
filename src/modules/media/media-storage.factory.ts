import { LocalStorageAdapter } from "./adapters/local-storage.adapter";
import {
  MediaStorageProvider,
  MediaStorageProviderName,
} from "./media-storage.port";

export interface MediaStorageConfig {
  readonly provider: MediaStorageProviderName;
  readonly localRoot: string;
  readonly publicBaseUrl: string;
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
    case "cloudinary":
      throw new Error(
        "El proveedor de media 'cloudinary' aún no está implementado. " +
          "Implementa un CloudinaryAdapter que cumpla MediaStorageProvider y " +
          "regístralo en createMediaStorageProvider, o usa MEDIA_STORAGE_PROVIDER=local.",
      );
    case "s3":
      throw new Error(
        "El proveedor de media 's3' aún no está implementado. " +
          "Implementa un S3Adapter que cumpla MediaStorageProvider y regístralo " +
          "en createMediaStorageProvider, o usa MEDIA_STORAGE_PROVIDER=local.",
      );
    default: {
      const exhaustiveCheck: never = config.provider;
      throw new Error(
        `Proveedor de media desconocido: ${String(exhaustiveCheck)}.`,
      );
    }
  }
}
