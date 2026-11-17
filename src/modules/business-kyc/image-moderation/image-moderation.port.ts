/** DI token of the image moderation provider (ADR-0021). */
export const IMAGE_MODERATION_PORT = Symbol("IMAGE_MODERATION_PORT");

export type ImageModerationVerdict =
  | { outcome: "OK" }
  | { outcome: "FLAGGED"; labels: readonly string[] }
  /** No provider, or it could not answer: the human post-review covers the image. */
  | { outcome: "UNAVAILABLE" };

/** Judges a public image (a business logo) for explicit, violent or deceptive content. */
export interface ImageModerationPort {
  readonly name: string;
  moderate(image: { url: string }): Promise<ImageModerationVerdict>;
}

/** Default: no provider is contracted yet, so every image is left to REPP's post-review. */
export class NoopImageModeration implements ImageModerationPort {
  readonly name = "noop";

  moderate(): Promise<ImageModerationVerdict> {
    return Promise.resolve({ outcome: "UNAVAILABLE" });
  }
}
