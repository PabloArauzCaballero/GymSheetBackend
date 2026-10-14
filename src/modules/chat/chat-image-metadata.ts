import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";

const imageFormats = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;

/** Decodes and encodes chat photos, applying EXIF orientation while discarding metadata. */
export async function stripChatImageMetadata(buffer: Buffer, mimeType: string): Promise<Buffer> {
  const format = imageFormats[mimeType as keyof typeof imageFormats];
  if (!format) throw new BadRequestException("Tipo de imagen no admitido.");

  try {
    const image = sharp(buffer, { animated: format === "gif", limitInputPixels: 50_000_000 });
    const metadata = await image.metadata();
    if (metadata.format !== format) throw new Error("Image format does not match MIME type");
    return await image.rotate().toFormat(format).toBuffer();
  } catch {
    throw new BadRequestException("Imagen no válida.");
  }
}
