import { ReelModel } from "./reel.model";

export interface ReelResponse {
  id: string;
  userId: string;
  mediaUrl: string;
  durationSeconds: number;
  status: "READY";
  createdAt: string;
}

export function reelMediaUrl(reelId: string): string {
  return `/me/reels/${reelId}/media`;
}

export function mapReelToResponse(reel: ReelModel): ReelResponse {
  return {
    id: reel.id,
    userId: reel.userId,
    mediaUrl: reelMediaUrl(reel.id),
    durationSeconds: Number(reel.durationSeconds),
    status: "READY",
    createdAt: new Date(reel.createdAt).toISOString(),
  };
}
