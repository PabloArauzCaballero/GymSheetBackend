export type StoryAudienceMode = "ALL_CONNECTIONS" | "SELECTED_CONNECTIONS";

export interface StoryAudienceFacts {
  readonly authorId: string;
  readonly audienceMode: StoryAudienceMode;
  readonly expiresAt: Date | null | undefined;
  readonly hiddenAt: Date | null;
  readonly hasAcceptedConnection: boolean;
  readonly isSelectedRecipient: boolean;
  readonly isBlocked: boolean;
}

/** One policy for feed item access, view receipts, and media delivery. */
export function canViewStory(
  actorId: string,
  story: StoryAudienceFacts,
  now: Date = new Date(),
): boolean {
  if (
    !story.expiresAt ||
    story.expiresAt.getTime() <= now.getTime() ||
    (story.hiddenAt !== null && story.hiddenAt !== undefined)
  ) return false;
  if (actorId === story.authorId) return true;
  if (story.isBlocked || !story.hasAcceptedConnection) return false;
  return story.audienceMode === "ALL_CONNECTIONS" || story.isSelectedRecipient;
}
