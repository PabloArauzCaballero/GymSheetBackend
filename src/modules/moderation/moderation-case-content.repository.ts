import { Injectable } from "@nestjs/common";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { LISTING_CONTENT_SQL, ListingContentRow, ORDER_CONTENT_SQL, OrderContentRow, PROFILE_CONTENT_SQL, ProfileContentRow } from "./moderation-business-content";

/** Raw rows read for the case content snapshot; `moderation-case-content.mapper.ts` turns them into the response. */
export type RoutineContentRow = {
  name: string;
  description: string | null;
  visibility: string;
  copies: number;
  liveCopies: number;
  activations: number;
};
export type RoutineExerciseContentRow = {
  dayId: string | null;
  dayName: string | null;
  weekday: number | null;
  exerciseName: string;
  sets: number;
  repsMin: number | null;
  repsMax: number | null;
  weightKg: string | number | null;
  durationSeconds: number | null;
};
export type ExerciseContentRow = {
  name: string;
  description: string | null;
  primaryGroup: string;
  groups: string[] | null;
  steps: unknown;
  media: { type: string; url: string }[] | null;
};
export type CommentContentRow = { text: string; state: string; attachmentUrl: string | null; attachmentType: string | null };
export type MediaContentRow = { mediaUrl: string; mediaType: string | null; caption: string | null };
export type UserContentRow = { displayName: string; mainPhotoUrl: string | null; closed: boolean };
export type PlaylistContentRow = { name: string; url: string; type: string; imageUrl: string | null };

/**
 * Reads the reported target as it is now, whatever its visibility or
 * moderation state: the moderator must see what was hidden. A missing row
 * (null) means the target was erased.
 */
@Injectable()
export class ModerationCaseContentRepository {
  constructor(private readonly sequelize: Sequelize) {}

  private one<T extends object>(sql: string, targetId: string): Promise<T | null> {
    return this.sequelize
      .query<T>(sql, { type: QueryTypes.SELECT, replacements: { targetId } })
      .then((rows) => rows[0] ?? null);
  }

  findListing(targetId: string): Promise<ListingContentRow | null> {
    return this.one(LISTING_CONTENT_SQL, targetId);
  }

  findBusinessProfile(targetId: string): Promise<ProfileContentRow | null> {
    return this.one(PROFILE_CONTENT_SQL, targetId);
  }

  findPaymentOrder(targetId: string): Promise<OrderContentRow | null> {
    return this.one(ORDER_CONTENT_SQL, targetId);
  }

  findRoutine(targetId: string): Promise<RoutineContentRow | null> {
    return this.one(
      `SELECT r.nombre AS "name", r.descripcion AS "description", r.visibilidad AS "visibility",
              r.copias_total AS "copies", r.activaciones_total AS "activations",
              (SELECT count(*)::int FROM training.routines k
                WHERE k.basada_en_rutina_id = r.id AND k.estado = 'ACTIVE') AS "liveCopies"
         FROM training.routines r WHERE r.id = :targetId`,
      targetId,
    );
  }

  /** Exercises in day order, then in their order inside the day; exercises without a day go last. */
  findRoutineExercises(targetId: string): Promise<RoutineExerciseContentRow[]> {
    return this.sequelize.query<RoutineExerciseContentRow>(
      `SELECT d.id AS "dayId", d.nombre AS "dayName", d.dia_semana AS "weekday",
              COALESCE(e.nombre_es, e.nombre) AS "exerciseName", re.series_objetivo AS "sets",
              re.reps_min AS "repsMin", re.reps_max AS "repsMax", re.peso_objetivo_kg AS "weightKg",
              re.duracion_seg AS "durationSeconds"
         FROM training.routine_exercises re
         JOIN public.ejercicios e ON e.id = re.ejercicio_id
         LEFT JOIN training.routine_days d ON d.id = re.routine_day_id
        WHERE re.routine_id = :targetId
        ORDER BY d.orden ASC NULLS LAST, d.id, re.orden ASC, re.id`,
      { type: QueryTypes.SELECT, replacements: { targetId } },
    );
  }

  /** Days without exercises still count: the routine shows them. */
  findRoutineDays(targetId: string): Promise<{ id: string; name: string | null; weekday: number | null }[]> {
    return this.sequelize.query(
      `SELECT id, nombre AS "name", dia_semana AS "weekday" FROM training.routine_days
        WHERE routine_id = :targetId ORDER BY orden ASC, id`,
      { type: QueryTypes.SELECT, replacements: { targetId } },
    );
  }

  findExercise(targetId: string): Promise<ExerciseContentRow | null> {
    return this.one(
      `SELECT COALESCE(e.nombre_es, e.nombre) AS "name", e.descripcion AS "description",
              e.grupo_muscular AS "primaryGroup", e.instruction_steps AS "steps",
              (SELECT array_agg(DISTINCT g.code ORDER BY g.code)
                 FROM training.exercise_muscles em
                 JOIN training.muscles m ON m.id = em.muscle_id
                 JOIN training.muscle_groups g ON g.id = m.muscle_group_id
                WHERE em.ejercicio_id = e.id) AS "groups",
              (SELECT json_agg(json_build_object('type', m.media_type, 'url', m.url) ORDER BY m.sort_order, m.created_at)
                 FROM training.exercise_media m WHERE m.ejercicio_id = e.id) AS "media"
         FROM public.ejercicios e WHERE e.id = :targetId`,
      targetId,
    );
  }

  findComment(targetId: string): Promise<CommentContentRow | null> {
    return this.one(
      `SELECT texto AS "text", estado AS "state", adjunto_url AS "attachmentUrl", adjunto_tipo AS "attachmentType"
         FROM community.content_comments WHERE id = :targetId`,
      targetId,
    );
  }

  findReel(targetId: string): Promise<{ mimeType: string } | null> {
    return this.one(`SELECT mime_type AS "mimeType" FROM social.reels WHERE id = :targetId`, targetId);
  }

  findStory(targetId: string): Promise<MediaContentRow | null> {
    return this.one(
      `SELECT media_url AS "mediaUrl", media_type AS "mediaType", caption FROM profile.stories WHERE id = :targetId`,
      targetId,
    );
  }

  findProfilePhoto(targetId: string): Promise<MediaContentRow | null> {
    return this.one(
      `SELECT url AS "mediaUrl", NULL AS "mediaType", NULL AS caption FROM profile.photos WHERE id = :targetId`,
      targetId,
    );
  }

  /** The first photo of the gallery, hidden or not: the profile as it was reported. */
  findUser(targetId: string): Promise<UserContentRow | null> {
    return this.one(
      `SELECT u.nombre_completo AS "displayName", (u.closed_at IS NOT NULL) AS "closed",
              (SELECT p.url FROM profile.photos p WHERE p.user_id = u.id AND p.author_deleted_at IS NULL
                ORDER BY p.position ASC, p.created_at ASC LIMIT 1) AS "mainPhotoUrl"
         FROM public.usuarios u WHERE u.id = :targetId`,
      targetId,
    );
  }

  findPlaylist(targetId: string): Promise<PlaylistContentRow | null> {
    return this.one(
      `SELECT titulo AS "name", url, tipo AS "type", imagen_url AS "imageUrl"
         FROM community.music_playlists WHERE id = :targetId`,
      targetId,
    );
  }
}
