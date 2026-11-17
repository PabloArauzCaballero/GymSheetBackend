/**
 * Building blocks of the account-closure catalogue.
 *
 * A step is one table and one predicate over the alias `t` (replacement
 * `:userId`). The SAME predicate drives the preview count and the erasure, so
 * what the preview promises is exactly what the closure does.
 */
export type ClosureDisposition = "DELETED" | "ANONYMIZED" | "KEPT";

/** One SQL expression yielding a storage key, or several when a row holds several files. */
export type MediaKeySql = string | readonly string[];

/** The storage-key expressions of a step, as a list. */
export const mediaKeysOf = (mediaKey: MediaKeySql | undefined): readonly string[] =>
  mediaKey === undefined ? [] : typeof mediaKey === "string" ? [mediaKey] : mediaKey;

export type ClosureStep = {
  /** `schema.table`, as the preview and the e2e coverage test name it. */
  table: string;
  /** Spanish label for the closure screen. */
  label: string;
  disposition: ClosureDisposition;
  /** SQL predicate over alias `t`; may use `:userId`. */
  where: string;
  /** SET clause of an ANONYMIZED step. */
  set?: string;
  /** Spanish reason for a kept or anonymized row, shown in the preview. */
  reason?: string;
  /** SQL expression(s) over `t` yielding the storage key(s) to erase after commit (e.g. a file and its poster). */
  mediaKey?: MediaKeySql;
  /** Side effect on other people's rows: runs, but is not listed in the preview. */
  internal?: boolean;
  /**
   * Counted by the preview with this same predicate, but applied by the
   * business closure (orders, affiliations, periods: stock, history and a
   * notice per row), never by the generic UPDATE (ADR-0028).
   */
  effect?: BusinessClosureEffect;
};

export type BusinessClosureEffect = "CANCEL_UNPAID_ORDERS" | "END_AFFILIATIONS" | "CANCEL_PERIODS";

export const del = (table: string, label: string, where: string, mediaKey?: MediaKeySql): ClosureStep => ({
  table,
  label,
  disposition: "DELETED",
  where,
  mediaKey,
});

export const anonymize = (
  table: string,
  label: string,
  where: string,
  set: string,
  reason: string,
  mediaKey?: MediaKeySql,
): ClosureStep => ({ table, label, disposition: "ANONYMIZED", where, set, reason, mediaKey });

export const keep = (table: string, label: string, where: string, reason: string): ClosureStep => ({
  table,
  label,
  disposition: "KEPT",
  where,
  reason,
});

/** Content under a moderation report is evidence: it survives the closure (same rule as the chat purge). */
export const reported = (kind: string, idColumn = "t.id"): string =>
  `EXISTS (SELECT 1 FROM moderation.reports r WHERE r.target_kind = '${kind}' AND r.target_id = ${idColumn})`;

/**
 * Storage key of a file in the owner's folder (a comment attachment, a personal
 * exercise upload). Those rows keep only the public URL; the key is the part
 * from the owner's folder on, which every adapter lays out the
 * same way (`mediaTargetPrefix`). URLs outside the owner's folder yield null.
 */
export const ownFolderKey = (urlColumn: string, owner = ":userId"): string =>
  // A URL with traversal, encoding, whitespace/control characters, a query or a
  // fragment never yields a key: only a plain path inside the owner's folder.
  `CASE WHEN strpos(${urlColumn}, 'users/' || ${owner} || '/') > 0
         AND ${urlColumn} !~ '(\\.\\.|%|//users/|[[:space:][:cntrl:]]|[?#])'
        THEN substr(${urlColumn}, strpos(${urlColumn}, 'users/' || ${owner} || '/')) END`;

/**
 * Storage key of a personal exercise upload (file or poster) in the owner's
 * `ejercicios/` folder; null for catalog, foreign or other-folder URLs.
 */
export const ownExerciseUploadKey = (urlColumn: string, owner = ":userId"): string =>
  `CASE WHEN ${ownFolderKey(urlColumn, owner)} LIKE 'users/' || ${owner} || '/ejercicios/%'
        THEN ${ownFolderKey(urlColumn, owner)} END`;

/**
 * A routine of the person that someone else still uses: their program,
 * session, invite snapshot or assignment, or the gym's official catalogue
 * (written by staff for the gym, not personal content).
 */
export const routineUsedByOthers = (alias: string): string => `(
  ${alias}.es_oficial
  OR EXISTS (SELECT 1 FROM training.routine_assignments a WHERE a.routine_id = ${alias}.id AND a.cliente_user_id <> :userId)
  OR EXISTS (SELECT 1 FROM training.training_programs p WHERE p.routine_id = ${alias}.id AND p.usuario_id <> :userId)
  OR EXISTS (SELECT 1 FROM public.sesiones_entrenamiento s WHERE s.routine_id = ${alias}.id AND s.usuario_id <> :userId)
  OR EXISTS (SELECT 1 FROM training.training_invite_shared_snapshots sn
              JOIN training.training_invites i ON i.id = sn.invite_id
             WHERE sn.source_routine_id = ${alias}.id
               AND i.inviter_id <> :userId AND i.recipient_id <> :userId))`;

/** Fields wiped from a chat message, the same set as "delete for everyone". */
export const WIPED_MESSAGE_FIELDS = `deleted_at = COALESCE(t.deleted_at, now()), body = NULL, idempotency_body = NULL,
  type = 'text', edited_at = NULL, media_provider = NULL, media_key = NULL, media_url = NULL,
  media_mime_type = NULL, media_size_bytes = NULL, location_lat = NULL, location_lng = NULL,
  location_label = NULL, view_once = false, viewed_at = NULL, story_id = NULL, reply_to_id = NULL,
  forwarded = false, client_request_id = NULL, deleted_request_hash = NULL`;
