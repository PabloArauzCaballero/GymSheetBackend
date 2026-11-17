import sharp from "sharp";

/** Edge of the square thumbnail: the 60 pt story ring at 3x, rounded up. */
export const STORY_THUMBNAIL_SIZE = 192;
export const STORY_THUMBNAIL_MIME_TYPE = "image/webp";

/**
 * Small square WebP of a story photo for the story ring, so the feed does not
 * download every full-size image (often several MB) just to fill a 60 pt circle.
 * Applies EXIF orientation and drops metadata; only the first GIF frame is used.
 */
export async function renderStoryThumbnail(image: Buffer): Promise<Buffer> {
  return sharp(image, { limitInputPixels: 50_000_000 })
    .rotate()
    .resize(STORY_THUMBNAIL_SIZE, STORY_THUMBNAIL_SIZE, { fit: "cover" })
    .webp({ quality: 70 })
    .toBuffer();
}
