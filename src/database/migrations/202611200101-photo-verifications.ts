import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Person verification with a gesture selfie (franja 6).
 *
 * `social.photo_verifications` keeps one row per attempt: the random gesture
 * the member was asked for, the 10-minute challenge window, the private storage
 * key of the selfie (never a public URL) and the manual moderation decision.
 * Approval fills `usuarios.verified_at` (added by 202611190101), which the
 * Conocer ranking already reads.
 *
 * - One active attempt (PENDING_UPLOAD / PENDING_REVIEW) per member, enforced
 *   by a partial unique index.
 * - `approved_photo_ids` snapshots the profile photos the moderator compared
 *   against; deleting all of them clears `verified_at` (`revoked_at`).
 * - Retention clears `selfie_storage_key` and stamps `selfie_deleted_at`; the
 *   row keeps status and dates only.
 * - `user_id` cascades so account erasure removes the rows; the reviewer FK is
 *   SET NULL so removing a staff account never erases a member's history.
 *
 * Rollback drops the table; it holds no data any other table depends on.
 */
const upStatements = [
  `CREATE TABLE IF NOT EXISTS social.photo_verifications (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     gesture_code varchar(20) NOT NULL,
     challenge_issued_at timestamptz NOT NULL,
     challenge_expires_at timestamptz NOT NULL,
     selfie_storage_key text NULL,
     selfie_mime_type varchar(20) NULL,
     selfie_deleted_at timestamptz NULL,
     status varchar(16) NOT NULL DEFAULT 'PENDING_UPLOAD',
     reviewer_id uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
     decision_reason varchar(30) NULL,
     decided_at timestamptz NULL,
     submitted_at timestamptz NULL,
     approved_photo_ids uuid[] NULL,
     revoked_at timestamptz NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_photo_verifications_status CHECK (status IN
       ('PENDING_UPLOAD', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED')),
     CONSTRAINT ck_photo_verifications_gesture CHECK (gesture_code IN
       ('THUMB_UP', 'PEACE_SIGN', 'HAND_ON_CHIN', 'TOUCH_EAR', 'POINT_UP', 'OPEN_PALM', 'WINK_THUMB', 'CHIN_UP')),
     CONSTRAINT ck_photo_verifications_reason CHECK (decision_reason IS NULL OR decision_reason IN
       ('FACE_NOT_VISIBLE', 'GESTURE_MISMATCH', 'DOES_NOT_MATCH_PHOTOS', 'MULTIPLE_PEOPLE', 'LOW_QUALITY', 'OTHER')),
     CONSTRAINT ck_photo_verifications_window CHECK (challenge_expires_at > challenge_issued_at),
     CONSTRAINT ck_photo_verifications_decided CHECK (
       (status IN ('APPROVED', 'REJECTED')) = (decided_at IS NOT NULL)),
     CONSTRAINT ck_photo_verifications_rejected_reason CHECK (
       status <> 'REJECTED' OR decision_reason IS NOT NULL)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_photo_verifications_active
     ON social.photo_verifications (user_id)
     WHERE status IN ('PENDING_UPLOAD', 'PENDING_REVIEW')`,
  `CREATE INDEX IF NOT EXISTS ix_photo_verifications_user_created
     ON social.photo_verifications (user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_photo_verifications_queue
     ON social.photo_verifications (submitted_at, id)
     WHERE status = 'PENDING_REVIEW'`,
  `CREATE INDEX IF NOT EXISTS ix_photo_verifications_retention
     ON social.photo_verifications (decided_at)
     WHERE selfie_storage_key IS NOT NULL`,
] as const;

const downStatements = [`DROP TABLE IF EXISTS social.photo_verifications`] as const;

export const photoVerificationsMigration: DatabaseMigration = {
  id: "202611200101-photo-verifications",
  description: "Creates social.photo_verifications for gesture-selfie person verification reviewed by moderation.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
