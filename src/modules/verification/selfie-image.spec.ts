import { BadRequestException } from "@nestjs/common";
import { env } from "../../config/env";
import { sniffSelfieType, UploadedSelfie, validateSelfie } from "./selfie-image";
import { SelfieLinkSigner } from "./selfie-link.signer";

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const HEIC_BYTES = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic", "latin1"), Buffer.alloc(8)]);

const file = (overrides: Partial<UploadedSelfie> = {}): UploadedSelfie => ({
  originalname: "selfie.jpg",
  mimetype: "image/jpeg",
  size: JPEG_BYTES.length,
  buffer: JPEG_BYTES,
  ...overrides,
});

describe("selfie validation", () => {
  it("recognises JPEG, PNG and HEIC by their magic bytes", () => {
    expect(sniffSelfieType(JPEG_BYTES)).toBe("image/jpeg");
    expect(sniffSelfieType(PNG_BYTES)).toBe("image/png");
    expect(sniffSelfieType(HEIC_BYTES)).toBe("image/heic");
    expect(sniffSelfieType(Buffer.from("<html>"))).toBeNull();
  });

  it("accepts a JPEG and a HEIF declared as image/heif", () => {
    expect(validateSelfie(file()).mimeType).toBe("image/jpeg");
    expect(validateSelfie(file({ mimetype: "image/heif", buffer: HEIC_BYTES, size: HEIC_BYTES.length })).mimeType)
      .toBe("image/heic");
  });

  it.each([
    ["missing", undefined],
    ["empty", file({ size: 0, buffer: Buffer.alloc(0) })],
    ["too large", file({ size: env.MEDIA_UPLOAD_MAX_BYTES + 1 })],
    ["not allowed type", file({ mimetype: "image/gif" })],
    ["renamed HTML", file({ buffer: Buffer.from("<html><script>"), size: 14 })],
    ["PNG declared as JPEG", file({ buffer: PNG_BYTES, size: PNG_BYTES.length })],
  ])("rejects a %s file with 400", (_label, input) => {
    expect(() => validateSelfie(input)).toThrow(BadRequestException);
  });
});

describe("selfie link signer", () => {
  const signer = new SelfieLinkSigner("x".repeat(64));
  const now = new Date("2026-11-20T12:00:00.000Z");
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  const id = "00000000-0000-4000-8000-000000000001";
  const viewer = "00000000-0000-4000-8000-000000000002";

  it("validates only for the same verification, viewer and expiry, before it expires", () => {
    const signature = signer.sign(id, viewer, expiresAt);
    expect(signer.isValid(id, viewer, expiresAt.getTime(), signature, now)).toBe(true);
    expect(signer.isValid(id, "00000000-0000-4000-8000-000000000003", expiresAt.getTime(), signature, now)).toBe(false);
    expect(signer.isValid(id, viewer, expiresAt.getTime() + 1, signature, now)).toBe(false);
    expect(signer.isValid(id, viewer, expiresAt.getTime(), signature, expiresAt)).toBe(false);
    expect(new SelfieLinkSigner("y".repeat(64)).isValid(id, viewer, expiresAt.getTime(), signature, now)).toBe(false);
  });
});
