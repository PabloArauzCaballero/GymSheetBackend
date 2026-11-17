import { BadRequestException } from "@nestjs/common";
import { env } from "../../config/env";

/** Multer memoryStorage shape, as in the profile photo upload. */
export interface UploadedSelfie {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

export type SelfieMimeType = "image/jpeg" | "image/png" | "image/heic";

const DECLARED_TYPES: Readonly<Record<string, SelfieMimeType>> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/heic": "image/heic",
  "image/heif": "image/heic",
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/** Content type from the leading bytes, independent of what the client declared. */
export function sniffSelfieType(buffer: Buffer): SelfieMimeType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (buffer.length >= 12 && buffer.toString("latin1", 4, 8) === "ftyp") {
    return HEIF_BRANDS.has(buffer.toString("latin1", 8, 12)) ? "image/heic" : null;
  }
  return null;
}

/**
 * Same limits as a profile photo (`MEDIA_UPLOAD_MAX_BYTES`), JPEG/PNG/HEIC
 * only, and the declared type must match the magic bytes so a renamed file
 * cannot reach the moderator's browser as something else.
 */
export function validateSelfie(file: UploadedSelfie | undefined): { mimeType: SelfieMimeType; buffer: Buffer } {
  if (!file || !file.buffer || file.size === 0) {
    throw new BadRequestException("Se requiere una selfie no vacía.");
  }
  if (file.size > env.MEDIA_UPLOAD_MAX_BYTES) {
    throw new BadRequestException(
      `La imagen excede el tamaño máximo de ${env.MEDIA_UPLOAD_MAX_BYTES} bytes.`,
    );
  }
  const declared = DECLARED_TYPES[file.mimetype.toLowerCase()];
  if (!declared) throw new BadRequestException("Solo se admiten selfies JPEG, PNG o HEIC.");
  if (sniffSelfieType(file.buffer) !== declared) {
    throw new BadRequestException("El contenido del archivo no corresponde a una imagen válida.");
  }
  return { mimeType: declared, buffer: file.buffer };
}
