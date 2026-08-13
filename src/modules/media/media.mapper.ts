import { MediaFileModel } from "../membership/media-file.model";

/**
 * Proyección pública de un archivo de media. Nunca se devuelve el modelo ORM
 * directamente (regla 10-backend-architecture). El campo `url` respeta el
 * mismo criterio que el mapper de membresía: preferir el almacenamiento
 * gestionado sobre la URL de origen externa.
 */
export function mapMediaFile(file: MediaFileModel) {
  return {
    id: file.id,
    publicId: file.publicId,
    codigo: file.code,
    nombre: file.name,
    tipo: file.fileType,
    mimeType: file.mimeType,
    proveedor: file.sourceName,
    origen: file.sourceType,
    url: file.storageUrl ?? file.sourceUrl,
    altText: file.altText,
    width: file.width,
    height: file.height,
    licencia: file.license,
    atribucion: file.attribution,
    estado: file.status,
    creadoEl: file.createdAt,
    actualizadoEl: file.updatedAt,
  };
}
