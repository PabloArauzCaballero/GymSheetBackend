import { HttpStatus } from "@nestjs/common";
import sharp from "sharp";
import { DomainException } from "../../common/errors/domain.exception";
import { sniffSelfieType, UploadedSelfie } from "../verification/selfie-image";
import { KYC_RULES } from "./kyc.catalog";

export type KycImageMime = "image/jpeg" | "image/png";
export type ReadabilityCode = "UNDECODABLE" | "TOO_SMALL" | "LOW_CONTRAST" | "TOO_DARK" | "TOO_BRIGHT";

/** Thresholds of the readability check at upload (plan §2.6). */
export const READABILITY = {
  minShortSidePx: 800,
  /** Luminance standard deviation (0–255) below which a photo is a blank or blurred surface. */
  minLuminanceStdDev: 18,
  minMeanLuminance: 35,
  maxMeanLuminance: 235,
  /** Pixel cap given to the decoder: a decompression bomb fails instead of exhausting memory. */
  maxInputPixels: 50_000_000,
} as const;

export type MeasuredDocument = {
  mime: KycImageMime;
  buffer: Buffer;
  width: number | null;
  height: number | null;
  readable: boolean;
  readabilityCodes: ReadabilityCode[];
};

/**
 * Validates a KYC photo and measures whether it can be read, at upload, so
 * the client can ask for another shot at once. Type by magic bytes, never by
 * the declared name: JPEG or PNG only (HEIC is refused: the bundled decoder
 * cannot read it, so it could never be judged readable). Size ≤ 8 MB.
 */
export async function measureKycDocument(file: UploadedSelfie | undefined): Promise<MeasuredDocument> {
  if (!file?.buffer || file.size === 0) {
    throw new DomainException(HttpStatus.BAD_REQUEST, "KYC_DOCUMENT_UNSUPPORTED", "Adjunta una foto.");
  }
  if (file.size > KYC_RULES.documentMaxBytes) {
    throw new DomainException(HttpStatus.PAYLOAD_TOO_LARGE, "KYC_DOCUMENT_UNSUPPORTED", "La foto no puede pasar de 8 MB.");
  }
  const sniffed = sniffSelfieType(file.buffer);
  if (sniffed !== "image/jpeg" && sniffed !== "image/png") {
    throw new DomainException(HttpStatus.BAD_REQUEST, "KYC_DOCUMENT_UNSUPPORTED", "Usa una foto JPEG o PNG.");
  }
  return { mime: sniffed, buffer: file.buffer, ...(await readability(file.buffer)) };
}

async function readability(buffer: Buffer): Promise<Omit<MeasuredDocument, "mime" | "buffer">> {
  try {
    const image = sharp(buffer, { limitInputPixels: READABILITY.maxInputPixels, failOn: "error" });
    const { width, height } = await image.metadata();
    if (!width || !height) return { width: null, height: null, readable: false, readabilityCodes: ["UNDECODABLE"] };
    const codes: ReadabilityCode[] = [];
    if (Math.min(width, height) < READABILITY.minShortSidePx) codes.push("TOO_SMALL");
    // A downscaled grey copy is enough to judge exposure and contrast, and keeps it fast.
    const stats = await image.clone().rotate().resize({ width: 512, withoutEnlargement: true }).greyscale().stats();
    const luminance = stats.channels[0];
    if (luminance.stdev < READABILITY.minLuminanceStdDev) codes.push("LOW_CONTRAST");
    if (luminance.mean < READABILITY.minMeanLuminance) codes.push("TOO_DARK");
    if (luminance.mean > READABILITY.maxMeanLuminance) codes.push("TOO_BRIGHT");
    return { width, height, readable: codes.length === 0, readabilityCodes: codes };
  } catch {
    return { width: null, height: null, readable: false, readabilityCodes: ["UNDECODABLE"] };
  }
}
