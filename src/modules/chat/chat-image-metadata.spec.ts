import { readFileSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { stripChatImageMetadata } from "./chat-image-metadata";

describe("stripChatImageMetadata", () => {
  it("removes JPEG GPS EXIF and applies its visual orientation", async () => {
    const photo = readFileSync(join(__dirname, "fixtures/gps-orientation.jpg"));
    const original = await sharp(photo).metadata();
    expect(original.orientation).toBe(6);
    expect(original.exif).toBeDefined();

    const cleaned = await stripChatImageMetadata(photo, "image/jpeg");
    const metadata = await sharp(cleaned).metadata();
    expect(metadata).toEqual(expect.objectContaining({ format: "jpeg", width: 1, height: 2 }));
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect(cleaned.includes(Buffer.from("Exif\0\0"))).toBe(false);

    const { data } = await sharp(cleaned).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeLessThan(data[3]);
    expect(data[2]).toBeLessThan(data[5]);
  });

  it.each(["image/png", "image/webp"])("preserves alpha and MIME for %s while removing private metadata", async (mimeType) => {
    const format = mimeType === "image/png" ? "png" : "webp";
    const rgba = Buffer.from([255, 0, 0, 128]);
    const input = await sharp(rgba, { raw: { width: 1, height: 1, channels: 4 } })
      .withExif({ IFD0: { ImageDescription: "private location" } })
      .toFormat(format)
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const cleaned = await stripChatImageMetadata(input, mimeType);
    const metadata = await sharp(cleaned).metadata();
    expect(metadata.format).toBe(format);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.hasAlpha).toBe(true);
    const pixel = await sharp(cleaned).ensureAlpha().raw().toBuffer();
    expect(pixel[3]).toBe(128);
  });

  it("keeps both frames of an animated GIF", async () => {
    const animation = readFileSync(join(__dirname, "fixtures/two-frame.gif"));
    expect((await sharp(animation, { animated: true }).metadata()).pages).toBe(2);

    const cleaned = await stripChatImageMetadata(animation, "image/gif");
    const metadata = await sharp(cleaned, { animated: true }).metadata();
    expect(metadata.format).toBe("gif");
    expect(metadata.pages).toBe(2);
    expect(metadata.pageHeight).toBe(1);
  });
});
