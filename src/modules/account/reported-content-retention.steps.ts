import { WIPED_MESSAGE_FIELDS, ownFolderKey } from "./account-closure.steps";

/**
 * Content an account closure KEPT because it was reported (see the `keep`
 * steps of `account-closure.catalog.ts`) and what happens to it once every
 * report on it is closed and the evidence retention has run out: the same
 * erasure the closure would have applied. Every predicate is over alias `t`
 * and may use `:resolvedBefore`.
 *
 * Stories are not listed: they all expire after 24 h and the stories purge
 * removes them as soon as no report on them is open.
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
  /** SQL expression over `t`, evaluated before the change: the stored file to release. */
  mediaKey?: string;
  /** Provider the key was written to; absent = the configured one. */
  mediaProvider?: string;
};

/** Every report on the row is closed, the last one before `:resolvedBefore`. */
export const reportsClosedBefore = (kind: string): string => `
  EXISTS (SELECT 1 FROM moderation.reports r WHERE r.target_kind = '${kind}' AND r.target_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM moderation.reports r WHERE r.target_kind = '${kind}' AND r.target_id = t.id
                   AND (r.status IN ('PENDIENTE', 'EN_REVISION') OR r.resolved_at IS NULL
                        OR r.resolved_at > :resolvedBefore))`;

export const ownedByClosedAccount = (ownerColumn: string): string =>
  `EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = ${ownerColumn} AND u.closed_at IS NOT NULL)`;

const HAS_REPLIES = "EXISTS (SELECT 1 FROM community.content_comments c WHERE c.respuesta_a = t.id)";

export const REPORTED_CONTENT_RETENTION_STEPS: readonly ReportedContentStep[] = [
  { kind: "PROFILE_PHOTO", table: "profile.photos", owner: "t.user_id", mediaKey: "t.storage_key" },
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
  },
  {
    kind: "COMMENT",
    table: "community.content_comments",
    owner: "t.autor_id",
    where: `NOT ${HAS_REPLIES}`,
    mediaKey: ownFolderKey("t.adjunto_url", "t.autor_id::text"),
  },
  { kind: "MUSIC_PLAYLIST", table: "community.music_playlists", owner: "t.user_id" },
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
 * never block each other) and returns each changed row with the file it held
 * before the change.
 */
export function reportedContentBatchSql(step: ReportedContentStep): string {
  const target = `SELECT t.id, ${step.mediaKey ?? "NULL::text"} AS media_key,
                         ${step.mediaProvider ?? "NULL::text"} AS media_provider
                    FROM ${step.table} t
                   WHERE ${ownedByClosedAccount(step.owner)} AND ${reportsClosedBefore(step.kind)}
                         ${step.where ? `AND ${step.where}` : ""}
                   ORDER BY t.id LIMIT :limit FOR UPDATE OF t SKIP LOCKED`;
  const change = step.set
    ? `UPDATE ${step.table} t SET ${step.set} FROM target WHERE t.id = target.id`
    : `DELETE FROM ${step.table} t USING target WHERE t.id = target.id`;
  return `WITH target AS (${target}),
          changed AS (${change} RETURNING target.id, target.media_key, target.media_provider)
          SELECT id, media_key AS "storageKey", media_provider AS provider FROM changed`;
}
