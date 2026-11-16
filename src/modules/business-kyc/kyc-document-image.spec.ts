import { HttpException } from "@nestjs/common";
import sharp from "sharp";
import { measureKycDocument } from "./kyc-document-image";

async function photo(width: number, height: number, options: { flat?: number } = {}): Promise<Buffer> {
  const base = options.flat !== undefined
    ? sharp({ create: { width, height, channels: 3, background: { r: options.flat, g: options.flat, b: options.flat } } })
    : sharp({ create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: "gaussian", mean: 128, sigma: 60 } } });
  return base.jpeg({ quality: 70 }).toBuffer();
}

const file = (buffer: Buffer, mimetype = "image/jpeg") => ({ originalname: "x.jpg", mimetype, size: buffer.length, buffer });

describe("measureKycDocument", () => {
  it("accepts a sharp, well exposed photo whose short side is at least 800 px", async () => {
    const result = await measureKycDocument(file(await photo(1000, 820)));
    expect(result).toMatchObject({ mime: "image/jpeg", width: 1000, height: 820, readable: true, readabilityCodes: [] });
  });

  it("flags a small photo as TOO_SMALL", async () => {
    const result = await measureKycDocument(file(await photo(900, 600)));
    expect(result.readable).toBe(false);
    expect(result.readabilityCodes).toContain("TOO_SMALL");
  });

  it("flags a blank surface (no luminance variation) and its exposure", async () => {
    expect((await measureKycDocument(file(await photo(900, 900, { flat: 10 })))).readabilityCodes).toEqual(["LOW_CONTRAST", "TOO_DARK"]);
    expect((await measureKycDocument(file(await photo(900, 900, { flat: 250 })))).readabilityCodes).toEqual(["LOW_CONTRAST", "TOO_BRIGHT"]);
  });

  it("decides the type by the bytes, whatever the name or declared type says", async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).png().toBuffer();
    expect((await measureKycDocument(file(png, "image/jpeg"))).mime).toBe("image/png");
    await expect(measureKycDocument(file(Buffer.from("<html>not an image</html>")))).rejects.toThrow(HttpException);
  });

  it("refuses HEIC (the decoder cannot judge it), empty files and files over 8 MB", async () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(16)]);
    await expect(measureKycDocument(file(heic, "image/heic"))).rejects.toMatchObject({ response: { code: "KYC_DOCUMENT_UNSUPPORTED" } });
    await expect(measureKycDocument(undefined)).rejects.toThrow(HttpException);
    const big = { ...file(await photo(10, 10)), size: 8 * 1024 * 1024 + 1 };
    await expect(measureKycDocument(big)).rejects.toMatchObject({ status: 413 });
  });

  it("marks a corrupt JPEG as UNDECODABLE instead of failing the upload", async () => {
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64, 7)]);
    await expect(measureKycDocument(file(broken))).resolves.toMatchObject({ readable: false, readabilityCodes: ["UNDECODABLE"] });
  });
});
