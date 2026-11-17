import { MediaKeySql, WIPED_MESSAGE_FIELDS, mediaKeysOf, ownExerciseUploadKey, ownFolderKey } from "./account-closure.steps";

/**
 * Content kept as evidence because it was reported, and what happens to it
 * once every report on it is closed and the evidence retention has run out:
 * the same erasure the closure or the author's deletion would have applied.
 * Two sources: an account closure KEPT it (the `keep` steps of
 * `account-closure.catalog.ts`), or its author deleted it while a report was
 * open (evidence hold). Every predicate is over alias `t` and may use
 * `:resolvedBefore`.
 *
 * Stories are not listed: they all expire after 24 h and the stories purge
 * removes them, held ones included, as soon as no report on them is open.
 */
export type ReportedContentStep = {
  /** Moderation target kind of the row. */
  kind: string;
  table: string;
  /** Column of `t` holding the closed account's id. */
  owner: string;
  /** SET clause; absent = the row is deleted. */
  set?: string;
  /** Extra predicate over `t`. */
  where?: string;
  /** SQL expression(s) over `t`, evaluated before the change: the stored file(s) to release. */
  mediaKey?: MediaKeySql;
  /** Provider the key was written to; absent = the configured one. */
  mediaProvider?: string;
  /**
   * Predicate over `t`: its author deleted it while a report was open (the
   * evidence hold). Such a row is erased like a closed account's, whoever owns it.
   */
  heldByAuthorDeletion?: string;
  /** Column of `t` the reports point to; absent = `t.id` (the row itself is the reported target). */
  reportTarget?: string;
};

/** Every report on the row is closed, the last one before `:resolvedBefore`. */
export const reportsClosedBefore = (kind: string, target = "t.id"): string => `
  EXISTS (SELECT 1 FROM moderation.reports r WHERE r.target_kind = '${kind}' AND r.target_id = ${target})
  AND NOT EXISTS (SELECT 1 FROM moderation.reports r WHERE r.target_kind = '${kind}' AND r.target_id = ${target}
                   AND (r.status IN ('PENDIENTE', 'EN_REVISION') OR r.resolved_at IS NULL
                        OR r.resolved_at > :resolvedBefore))`;

export const ownedByClosedAccount = (ownerColumn: string): string =>
  `EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = ${ownerColumn} AND u.closed_at IS NOT NULL)`;

const HAS_REPLIES = "EXISTS (SELECT 1 FROM community.content_comments c WHERE c.respuesta_a = t.id)";
/** An author deletion under an open report leaves BORRADO_AUTOR with text and attachment intact. */
const COMMENT_DELETED_BY_AUTHOR = "t.estado = 'BORRADO_AUTOR'";

/** Owner of the personal exercise an upload belongs to (the reports point to the exercise). */
const EXERCISE_OWNER = "(SELECT e.created_by_usuario_id FROM public.ejercicios e WHERE e.id = t.ejercicio_id AND e.tipo_ejercicio = 'PERSONAL')";
const EXERCISE_UPLOAD_KEYS = [
  ownExerciseUploadKey("t.url", `${EXERCISE_OWNER}::text`),
  ownExerciseUploadKey("t.thumbnail_url", `${EXERCISE_OWNER}::text`),
] as const;
/** Nothing else points to the exercise any more (the closure kept the ones other people use for good). */
const EXERCISE_UNUSED = `NOT EXISTS (SELECT 1 FROM public.sesiones_ejercicios se WHERE se.ejercicio_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM training.routine_exercises re WHERE re.ejercicio_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM training.program_lift_targets lt WHERE lt.ejercicio_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.usuarios_ejercicios ue WHERE ue.ejercicio_id = t.id)`;
/** Its own uploads were released first (the media step); deleting the exercise would cascade them unreleased. */
const EXERCISE_UPLOADS_RELEASED = `NOT EXISTS (SELECT 1 FROM training.exercise_media m
  WHERE m.ejercicio_id = t.id AND (${ownExerciseUploadKey("m.url", "t.created_by_usuario_id::text")} IS NOT NULL
                                   OR ${ownExerciseUploadKey("m.thumbnail_url", "t.created_by_usuario_id::text")} IS NOT NULL))`;

export const REPORTED_CONTENT_RETENTION_STEPS: readonly ReportedContentStep[] = [
  {
    kind: "PROFILE_PHOTO",
    table: "profile.photos",
    owner: "t.user_id",
    mediaKey: "t.storage_key",
    heldByAuthorDeletion: "t.author_deleted_at IS NOT NULL",
  },
  { kind: "REEL", table: "social.reels", owner: "t.user_id", mediaKey: "t.storage_key" },
  // A comment with replies stays as «comentario borrado» (deleting it would cascade to the replies).
  {
    kind: "COMMENT",
    table: "community.content_comments",
    owner: "t.autor_id",
    where: `${HAS_REPLIES} AND (t.texto <> '' OR t.adjunto_url IS NOT NULL)`,
    set: `estado = 'BORRADO_AUTOR', texto = '', adjunto_tipo = NULL, adjunto_url = NULL, adjunto_mime = NULL,
          adjunto_nombre = NULL, adjunto_bytes = NULL, adjunto_ancho = NULL, adjunto_alto = NULL`,
    mediaKey: ownFolderKey("t.adjunto_url", "t.autor_id::text"),
    heldByAuthorDeletion: COMMENT_DELETED_BY_AUTHOR,
  },
  {
    kind: "COMMENT",
    table: "community.content_comments",
    owner: "t.autor_id",
    where: `NOT ${HAS_REPLIES}`,
    mediaKey: ownFolderKey("t.adjunto_url", "t.autor_id::text"),
    heldByAuthorDeletion: COMMENT_DELETED_BY_AUTHOR,
  },
  { kind: "MUSIC_PLAYLIST", table: "community.music_playlists", owner: "t.user_id" },
  // Uploads to a reported personal exercise, file and poster: kept at closure, or held when
  // their author deleted them under the report. Before the exercise, whose deletion cascades.
  {
    kind: "EXERCISE",
    table: "training.exercise_media",
    owner: EXERCISE_OWNER,
    reportTarget: "t.ejercicio_id",
    where: `(${EXERCISE_UPLOAD_KEYS[0]} IS NOT NULL OR ${EXERCISE_UPLOAD_KEYS[1]} IS NOT NULL)`,
    mediaKey: EXERCISE_UPLOAD_KEYS,
    heldByAuthorDeletion: "t.author_deleted_at IS NOT NULL",
  },
  {
    kind: "EXERCISE",
    table: "public.ejercicios",
    owner: "t.created_by_usuario_id",
    where: `t.tipo_ejercicio = 'PERSONAL' AND ${EXERCISE_UNUSED} AND ${EXERCISE_UPLOADS_RELEASED}`,
  },
  // The other person's chat keeps «mensaje eliminado», as for every other message of the closed account.
  {
    kind: "CHAT_MESSAGE",
    table: "chat.messages",
    owner: "t.sender_id",
    where: "t.deleted_at IS NULL",
    set: WIPED_MESSAGE_FIELDS,
    mediaKey: "t.media_key",
    mediaProvider: "t.media_provider",
  },
];

/**
 * One bounded batch of a step. Locks the candidates (SKIP LOCKED, so two runs
 * never block each other) and returns each changed row once per file it held
 * before the change.
 */
export function reportedContentBatchSql(step: ReportedContentStep): string {
  const keys = mediaKeysOf(step.mediaKey);
  const target = `SELECT t.id, ARRAY[${keys.length > 0 ? keys.join(", ") : "NULL"}]::text[] AS media_keys,
                         ${step.mediaProvider ?? "NULL::text"} AS media_provider
                    FROM ${step.table} t
                   WHERE (${ownedByClosedAccount(step.owner)}${step.heldByAuthorDeletion ? ` OR ${step.heldByAuthorDeletion}` : ""})
                         AND ${reportsClosedBefore(step.kind, step.reportTarget)}
                         ${step.where ? `AND ${step.where}` : ""}
                   ORDER BY t.id LIMIT :limit FOR UPDATE OF t SKIP LOCKED`;
  const change = step.set
    ? `UPDATE ${step.table} t SET ${step.set} FROM target WHERE t.id = target.id`
    : `DELETE FROM ${step.table} t USING target WHERE t.id = target.id`;
  // One row per stored file (a row without files yields one row with a null key).
  return `WITH target AS (${target}),
          changed AS (${change} RETURNING target.id, target.media_keys, target.media_provider)
          SELECT c.id, k.key AS "storageKey", c.media_provider AS provider
            FROM changed c LEFT JOIN LATERAL unnest(c.media_keys) AS k(key) ON true`;
}
