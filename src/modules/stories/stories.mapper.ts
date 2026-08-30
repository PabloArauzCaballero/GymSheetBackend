import { StoryFeedRow } from "./stories.repository";
import { StoryModel, StoryMediaType } from "./story.model";

export type StoryResponse = {
  id: string;
  mediaUrl: string;
  mediaType: StoryMediaType;
  createdAt: Date;
  expiresAt: Date;
};

export function mapStoryToResponse(story: StoryModel): StoryResponse {
  return {
    id: story.id,
    mediaUrl: story.mediaUrl,
    mediaType: story.mediaType,
    createdAt: story.createdAt,
    expiresAt: story.expiresAt,
  };
}

export type StoryFeedEntryResponse = {
  userId: string;
  fullName: string;
  photoUrl: string | null;
  hasUnviewed: boolean;
  stories: {
    id: string;
    mediaUrl: string;
    mediaType: StoryMediaType;
    createdAt: string;
    viewedByMe: boolean;
  }[];
};

/** Agrupa filas planas (una por story) en una entrada por usuario — el feed se recorre por persona, no por story suelta. */
export function mapFeedRowsToResponse(rows: StoryFeedRow[]): StoryFeedEntryResponse[] {
  const byUser = new Map<string, StoryFeedEntryResponse>();
  for (const row of rows) {
    let entry = byUser.get(row.user_id);
    if (!entry) {
      entry = { userId: row.user_id, fullName: row.full_name, photoUrl: row.photo_url, hasUnviewed: false, stories: [] };
      byUser.set(row.user_id, entry);
    }
    entry.stories.push({
      id: row.id,
      mediaUrl: row.media_url,
      mediaType: row.media_type,
      createdAt: row.created_at,
      viewedByMe: row.viewed_by_me,
    });
    if (!row.viewed_by_me) entry.hasUnviewed = true;
  }
  return Array.from(byUser.values());
}
