import { reelMediaUrl } from "../reels/reels.mapper";
import type {
  CommentContentRow,
  ExerciseContentRow,
  MediaContentRow,
  PlaylistContentRow,
  RoutineContentRow,
  RoutineExerciseContentRow,
  UserContentRow,
} from "./moderation-case-content.repository";

export type RoutineDayContent = {
  name: string | null;
  /** 1 = Monday … 7 = Sunday; null when the day has no weekday. */
  weekday: number | null;
  exercises: {
    name: string;
    sets: number;
    repsMin: number | null;
    repsMax: number | null;
    weightKg: number | null;
    durationSeconds: number | null;
  }[];
};

/**
 * Read-only copy of the reported target for the moderator (ADR-0018 §9).
 * Built only from plain rows, never from ORM models.
 */
export type CaseContent =
  | {
      kind: "ROUTINE";
      name: string;
      description: string | null;
      visibility: string;
      days: RoutineDayContent[];
      /** How far the routine already spread: counts only, no names. */
      reach: { copies: number; liveCopies: number; activations: number };
    }
  | {
      kind: "EXERCISE";
      name: string;
      description: string | null;
      muscleGroups: string[];
      instructions: string[];
      media: { type: string; url: string }[];
    }
  | { kind: "COMMENT"; text: string; attachmentUrl: string | null; attachmentType: string | null; deletedByAuthor: boolean }
  | { kind: "REEL" | "STORY" | "PROFILE_PHOTO"; mediaUrl: string; mediaType: string | null; caption: string | null }
  | { kind: "USER"; displayName: string; mainPhotoUrl: string | null }
  | { kind: "MUSIC_PLAYLIST"; name: string; url: string; type: string; imageUrl: string | null };

export function mapRoutineContent(
  routine: RoutineContentRow,
  days: { id: string; name: string | null; weekday: number | null }[],
  exercises: RoutineExerciseContentRow[],
): CaseContent {
  const byDay = new Map<string | null, RoutineDayContent>(
    days.map((day) => [day.id, { name: day.name, weekday: day.weekday, exercises: [] }]),
  );
  for (const row of exercises) {
    let day = byDay.get(row.dayId);
    if (!day) {
      // Exercises outside any day (older routines) are shown as one trailing day.
      day = { name: null, weekday: null, exercises: [] };
      byDay.set(row.dayId, day);
    }
    day.exercises.push({
      name: row.exerciseName,
      sets: row.sets,
      repsMin: row.repsMin,
      repsMax: row.repsMax,
      weightKg: row.weightKg === null ? null : Number(row.weightKg),
      durationSeconds: row.durationSeconds,
    });
  }
  return {
    kind: "ROUTINE",
    name: routine.name,
    description: routine.description,
    visibility: routine.visibility,
    days: [...byDay.values()],
    reach: { copies: routine.copies, liveCopies: routine.liveCopies, activations: routine.activations },
  };
}

/** Spanish steps first, then English: the console is in Spanish. */
function instructionSteps(steps: unknown): string[] {
  if (!steps || typeof steps !== "object") return [];
  const localized = steps as Record<string, unknown>;
  const chosen = Array.isArray(localized.es) && localized.es.length > 0 ? localized.es : localized.en;
  return Array.isArray(chosen) ? chosen.filter((step): step is string => typeof step === "string") : [];
}

export function mapExerciseContent(row: ExerciseContentRow): CaseContent {
  return {
    kind: "EXERCISE",
    name: row.name,
    description: row.description,
    muscleGroups: [...new Set([row.primaryGroup, ...(row.groups ?? [])])],
    instructions: instructionSteps(row.steps),
    media: (row.media ?? []).map((media) => ({ type: media.type, url: media.url })),
  };
}

/** A comment wiped by the erasure keeps its row (it has replies) but nothing of what it said. */
export function isErasedComment(row: CommentContentRow): boolean {
  return row.state === "BORRADO_AUTOR" && row.text === "" && row.attachmentUrl === null;
}

export function mapCommentContent(row: CommentContentRow): CaseContent {
  return {
    kind: "COMMENT",
    text: row.text,
    attachmentUrl: row.attachmentUrl,
    attachmentType: row.attachmentType,
    deletedByAuthor: row.state === "BORRADO_AUTOR",
  };
}

export function mapMediaContent(kind: "STORY" | "PROFILE_PHOTO", row: MediaContentRow): CaseContent {
  return { kind, mediaUrl: row.mediaUrl, mediaType: row.mediaType, caption: row.caption };
}

/** Reels carry no caption; the file is served by its media route. */
export function mapReelContent(reelId: string, row: { mimeType: string }): CaseContent {
  return { kind: "REEL", mediaUrl: reelMediaUrl(reelId), mediaType: row.mimeType, caption: null };
}

export function mapUserContent(row: UserContentRow): CaseContent {
  return { kind: "USER", displayName: row.displayName, mainPhotoUrl: row.mainPhotoUrl };
}

/** A playlist is a stored link (title + cover); its tracks live at the provider and are not stored. */
export function mapPlaylistContent(row: PlaylistContentRow): CaseContent {
  return { kind: "MUSIC_PLAYLIST", name: row.name, url: row.url, type: row.type, imageUrl: row.imageUrl };
}
