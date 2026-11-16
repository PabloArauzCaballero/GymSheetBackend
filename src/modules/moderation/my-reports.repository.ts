import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ModerationReportModel } from "./report.model";
import {
  ModerationReasonValue,
  ModerationStatusValue,
  ModerationTargetKindValue,
} from "./moderation.policy";
import { MyReportsCursor } from "./moderation.schemas";

/** One row of «Tus denuncias», as read from the database. */
export interface MyReportRow {
  id: string;
  targetKind: ModerationTargetKindValue;
  targetId: string;
  reason: ModerationReasonValue;
  status: ModerationStatusValue;
  /** ISO text with microseconds; also the keyset cursor. */
  createdAt: string;
  /** Name of named content (routine, exercise, playlist); null for the rest or when it is gone. */
  title: string | null;
  ownerName: string;
}

/**
 * Content hidden by the automatic threshold, and only that: a moderator's
 * decision (`*_MODERACION`, or `hidden_by_user_id` set) is never undone here.
 * Table names come from this closed map, never from the request.
 */
const REVEAL_AUTO_HIDDEN_SQL: Partial<Record<ModerationTargetKindValue, string>> = {
  ROUTINE: `UPDATE training.routines SET estado_moderacion = 'VISIBLE', updated_at = now()
             WHERE id = :targetId AND estado_moderacion = 'OCULTA_AUTO' RETURNING id`,
  EXERCISE: `UPDATE public.ejercicios SET estado_moderacion = 'VISIBLE', updated_at = now()
              WHERE id = :targetId AND estado_moderacion = 'OCULTO_AUTO' RETURNING id`,
  COMMENT: `UPDATE community.content_comments SET estado = 'VISIBLE', updated_at = now()
             WHERE id = :targetId AND estado = 'OCULTO_AUTO' RETURNING id`,
  STORY: autoHiddenAtSql("profile.stories"),
  PROFILE_PHOTO: autoHiddenAtSql("profile.photos"),
  REEL: autoHiddenAtSql("social.reels"),
  MUSIC_PLAYLIST: autoHiddenAtSql("community.music_playlists"),
};

function autoHiddenAtSql(table: string): string {
  return `UPDATE ${table} SET hidden_at = NULL, hidden_reason = NULL
           WHERE id = :targetId AND hidden_at IS NOT NULL AND hidden_by_user_id IS NULL RETURNING id`;
}

/** The reporter's side of moderation: their own reports, and withdrawing one. */
@Injectable()
export class MyReportsRepository {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(ModerationReportModel)
    private readonly reports: typeof ModerationReportModel,
  ) {}

  /** Live (not withdrawn) reports of one person, newest first, keyset-paginated. */
  listLive(reporterUserId: string, limit: number, cursor: MyReportsCursor | null): Promise<MyReportRow[]> {
    return this.sequelize.query<MyReportRow>(
      `SELECT r.id,
              r.target_kind AS "targetKind",
              r.target_id AS "targetId",
              r.reason,
              r.status,
              to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
              CASE r.target_kind
                WHEN 'ROUTINE' THEN (SELECT rt.nombre FROM training.routines rt WHERE rt.id = r.target_id)
                WHEN 'EXERCISE' THEN (SELECT COALESCE(e.nombre_es, e.nombre) FROM public.ejercicios e WHERE e.id = r.target_id)
                WHEN 'MUSIC_PLAYLIST' THEN (SELECT mp.titulo FROM community.music_playlists mp WHERE mp.id = r.target_id)
              END AS title,
              u.nombre_completo AS "ownerName"
         FROM moderation.reports r
         JOIN public.usuarios u ON u.id = r.reported_user_id
        WHERE r.reporter_user_id = :reporterUserId
          AND r.withdrawn_at IS NULL
          AND (CAST(:cursorAt AS timestamptz) IS NULL
               OR (r.created_at, r.id) < (CAST(:cursorAt AS timestamptz), CAST(:cursorId AS uuid)))
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT :limit`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          reporterUserId,
          limit,
          cursorAt: cursor?.createdAt ?? null,
          cursorId: cursor?.id ?? null,
        },
      },
    );
  }

  /**
   * The report, only if this person filed it, locked for the withdrawal.
   * Null otherwise: the caller answers 404 for someone else's report too.
   */
  findOwnForUpdate(reportId: string, reporterUserId: string, transaction: Transaction): Promise<ModerationReportModel | null> {
    return this.reports.findOne({
      where: { id: reportId, reporterUserId },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
  }

  async markWithdrawn(
    reportId: string,
    status: ModerationStatusValue,
    transaction: Transaction,
  ): Promise<Date> {
    const [row] = await this.sequelize.query<{ withdrawnAt: Date }>(
      `UPDATE moderation.reports
          SET status = :status, withdrawn_at = now(), updated_at = now()
        WHERE id = :reportId
        RETURNING withdrawn_at AS "withdrawnAt"`,
      { type: QueryTypes.SELECT, replacements: { reportId, status }, transaction },
    );
    return row.withdrawnAt;
  }

  /** Lifts the automatic curtain. True when something was hidden that way and is visible now. */
  async revealAutoHidden(
    targetKind: ModerationTargetKindValue,
    targetId: string,
    transaction: Transaction,
  ): Promise<boolean> {
    const sql = REVEAL_AUTO_HIDDEN_SQL[targetKind];
    if (!sql) return false;
    const rows = await this.sequelize.query<{ id: string }>(sql, {
      type: QueryTypes.SELECT,
      replacements: { targetId },
      transaction,
    });
    return rows.length > 0;
  }
}
