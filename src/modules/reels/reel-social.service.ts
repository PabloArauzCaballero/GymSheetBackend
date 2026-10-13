import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { QueryTypes } from "sequelize";
import { InjectConnection } from "@nestjs/sequelize";
import { Sequelize } from "sequelize-typescript";
import { env } from "../../config/env";

export type ReelTab = "FOR_YOU" | "CONNECTIONS" | "MINE";

interface ReelRow {
  id: string;
  userId: string;
  mediaUrl: string;
  durationSeconds: string | number;
  status: "READY";
  createdAt: Date | string;
  commentsEnabled: boolean;
  commentsCount: string | number;
  likesCount: string | number;
  likedByMe: boolean;
  savedByMe: boolean;
  repostedByMe: boolean;
  sharedBy: Array<{ userId: string; displayName: string }>;
  activityAt: Date | string;
}

@Injectable()
export class ReelSocialService {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async feed(userId: string, tab: ReelTab = "MINE", cursor?: string) {
    const cursorContext = createHash("sha256")
      .update(`${userId}:${tab}`)
      .digest("hex");
    const after = cursor ? readReelFeedCursor(cursor, cursorContext) : null;
    const sharedSources =
      tab === "CONNECTIONS"
        ? `UNION ALL
         SELECT repost.reel_id, repost.user_id, repost.created_at AS activity_at
           FROM social.reel_reposts repost
           JOIN social.reels original ON original.id = repost.reel_id
          WHERE repost.user_id <> original.user_id
            AND EXISTS (
              SELECT 1 FROM social.connections c
               WHERE c.status = 'ACCEPTED'
                 AND ((c.requester_id = :userId AND c.addressee_id = repost.user_id)
                   OR (c.addressee_id = :userId AND c.requester_id = repost.user_id))
            )`
        : "";
    const visibility =
      tab === "MINE"
        ? "r.user_id = CAST(:userId AS uuid)"
        : tab === "CONNECTIONS"
          ? `source.user_id = CAST(:userId AS uuid)
           OR EXISTS (
             SELECT 1 FROM social.connections c
              WHERE c.status = 'ACCEPTED'
                AND ((c.requester_id = CAST(:userId AS uuid) AND c.addressee_id = source.user_id)
                  OR (c.addressee_id = CAST(:userId AS uuid) AND c.requester_id = source.user_id))
           )`
          : `(
             r.user_id = CAST(:userId AS uuid)
             OR (settings.profile_enabled = true
               AND (author.tenant_id = viewer.tenant_id OR settings.cross_gym_enabled = true))
           )`;
    const sources =
      tab === "CONNECTIONS"
        ? `WITH source AS MATERIALIZED (
           SELECT r.id AS reel_id, r.user_id, r.created_at AS activity_at
             FROM social.reels r
           ${sharedSources}
         ), visible AS MATERIALIZED (
           SELECT source.reel_id, max(source.activity_at) AS activity_at,
                  array_agg(DISTINCT source.user_id) FILTER (
                    WHERE source.user_id <> original.user_id
                  ) AS sharing_user_ids
             FROM source
             JOIN social.reels original ON original.id = source.reel_id
            WHERE original.status = 'READY'
              AND original.hidden_at IS NULL
              AND original.deleted_at IS NULL
              AND (${visibility})
              AND ${visibleAuthorPair("original.user_id", "CAST(:userId AS uuid)")}
            GROUP BY source.reel_id, original.user_id
         )`
        : `WITH visible AS MATERIALIZED (
           SELECT r.id AS reel_id, r.created_at AS activity_at,
                  ARRAY[]::uuid[] AS sharing_user_ids
             FROM social.reels r
             JOIN public.usuarios author ON author.id = r.user_id
             JOIN public.usuarios viewer ON viewer.id = CAST(:userId AS uuid)
             LEFT JOIN social.profile_settings settings ON settings.user_id = author.id
            WHERE r.status = 'READY'
              AND r.hidden_at IS NULL
              AND r.deleted_at IS NULL
              AND (${visibility})
              AND ${visibleAuthorPair("r.user_id", "CAST(:userId AS uuid)")}
         )`;
    const rows = await this.sequelize.query<ReelRow>(
      `${sources}
       SELECT r.id,
              r.user_id AS "userId",
              '/me/reels/' || r.id::text || '/media' AS "mediaUrl",
              r.duration_seconds AS "durationSeconds",
              'READY' AS status,
              r.created_at AS "createdAt",
              r.comments_enabled AS "commentsEnabled",
              to_char(visible.activity_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "activityAt",
              (SELECT count(*) FROM social.reel_comments cm
                WHERE cm.reel_id = r.id AND cm.deleted_at IS NULL) AS "commentsCount",
              (SELECT count(*) FROM social.reel_likes lk WHERE lk.reel_id = r.id) AS "likesCount",
              EXISTS (SELECT 1 FROM social.reel_likes lk
                       WHERE lk.reel_id = r.id AND lk.user_id = CAST(:userId AS uuid)) AS "likedByMe",
              EXISTS (SELECT 1 FROM social.reel_saves sv
                       WHERE sv.reel_id = r.id AND sv.user_id = CAST(:userId AS uuid)) AS "savedByMe",
              EXISTS (SELECT 1 FROM social.reel_reposts rp
                       WHERE rp.reel_id = r.id AND rp.user_id = CAST(:userId AS uuid)) AS "repostedByMe",
              COALESCE((SELECT json_agg(json_build_object(
                 'userId', sharer.id, 'displayName', sharer.nombre_completo
               ) ORDER BY sharer.nombre_completo)
                FROM unnest(visible.sharing_user_ids) AS sharing(user_id)
                JOIN public.usuarios sharer ON sharer.id = sharing.user_id), '[]'::json) AS "sharedBy"
         FROM visible
         JOIN social.reels r ON r.id = visible.reel_id
        WHERE (CAST(:activityAt AS timestamptz) IS NULL
          OR (visible.activity_at, r.id) < (CAST(:activityAt AS timestamptz), CAST(:reelId AS uuid)))
        ORDER BY visible.activity_at DESC, r.id DESC
        LIMIT 51`,
      {
        replacements: {
          userId,
          activityAt: after?.activityAt ?? null,
          reelId: after?.reelId ?? "00000000-0000-0000-0000-000000000000",
        },
        type: QueryTypes.SELECT,
      },
    );
    const hasMore = rows.length > 50;
    const page = rows.slice(0, 50);
    const last = page.at(-1);
    return {
      items: page.map(mapRow),
      nextCursor:
        hasMore && last
          ? issueReelFeedCursor(
              {
                activityAt: String(last.activityAt),
                reelId: last.id,
              },
              cursorContext,
            )
          : null,
    } as const;
  }

  async saved(userId: string) {
    const rows = await this.sequelize.query<ReelRow>(
      `SELECT r.id, r.user_id AS "userId",
              '/me/reels/' || r.id::text || '/media' AS "mediaUrl",
              r.duration_seconds AS "durationSeconds", 'READY' AS status,
              r.created_at AS "createdAt", r.comments_enabled AS "commentsEnabled",
              (SELECT count(*) FROM social.reel_comments cm WHERE cm.reel_id = r.id AND cm.deleted_at IS NULL) AS "commentsCount",
              (SELECT count(*) FROM social.reel_likes lk WHERE lk.reel_id = r.id) AS "likesCount",
              EXISTS (SELECT 1 FROM social.reel_likes lk WHERE lk.reel_id = r.id AND lk.user_id = :userId) AS "likedByMe",
              true AS "savedByMe",
              EXISTS (SELECT 1 FROM social.reel_reposts rp WHERE rp.reel_id = r.id AND rp.user_id = :userId) AS "repostedByMe",
              '[]'::json AS "sharedBy"
         FROM social.reel_saves sv
         JOIN social.reels r ON r.id = sv.reel_id
        WHERE sv.user_id = :userId AND r.status = 'READY'
          AND r.hidden_at IS NULL AND r.deleted_at IS NULL
          AND ${visibleAuthorPair("r.user_id", "CAST(:userId AS uuid)")}
        ORDER BY sv.created_at DESC, r.id DESC LIMIT 50`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    return { items: rows.map(mapRow), nextCursor: null } as const;
  }

  async toggleSave(userId: string, reelId: string, saved: boolean) {
    await this.requireVisible(userId, reelId);
    if (saved) {
      await this.sequelize.query(
        `INSERT INTO social.reel_saves (user_id, reel_id)
         VALUES (:userId, :reelId) ON CONFLICT (user_id, reel_id) DO NOTHING`,
        { replacements: { userId, reelId } },
      );
    } else {
      await this.sequelize.query(
        `DELETE FROM social.reel_saves WHERE user_id = :userId AND reel_id = :reelId`,
        { replacements: { userId, reelId } },
      );
    }
    return { saved };
  }

  async toggleRepost(userId: string, reelId: string, reposted: boolean) {
    const visible = await this.requireVisible(userId, reelId);
    if (visible.userId === userId) {
      throw new ConflictException("No puedes repostear tu propio reel.");
    }
    if (reposted) {
      await this.sequelize.query(
        `INSERT INTO social.reel_reposts (user_id, reel_id)
         VALUES (:userId, :reelId) ON CONFLICT (user_id, reel_id) DO NOTHING`,
        { replacements: { userId, reelId } },
      );
    } else {
      await this.sequelize.query(
        `DELETE FROM social.reel_reposts WHERE user_id = :userId AND reel_id = :reelId`,
        { replacements: { userId, reelId } },
      );
    }
    return { reposted };
  }

  async toggleLike(userId: string, reelId: string, liked: boolean) {
    await this.requireVisible(userId, reelId);
    if (liked) {
      await this.sequelize.query(
        `INSERT INTO social.reel_likes (user_id, reel_id)
         VALUES (:userId, :reelId) ON CONFLICT (user_id, reel_id) DO NOTHING`,
        { replacements: { userId, reelId } },
      );
    } else {
      await this.sequelize.query(
        `DELETE FROM social.reel_likes WHERE user_id = :userId AND reel_id = :reelId`,
        { replacements: { userId, reelId } },
      );
    }
    return { liked };
  }

  async comments(userId: string, reelId: string) {
    await this.requireVisible(userId, reelId);
    return this.sequelize.query(
      `SELECT c.id, c.reel_id AS "reelId", c.parent_comment_id AS "parentCommentId",
              c.user_id AS "userId", u.nombre_completo AS "displayName",
              CASE WHEN c.deleted_at IS NULL THEN c.body ELSE NULL END AS body,
              (c.deleted_at IS NOT NULL) AS deleted, c.created_at AS "createdAt"
         FROM social.reel_comments c
         JOIN public.usuarios u ON u.id = c.user_id
        WHERE c.reel_id = :reelId AND (c.deleted_at IS NULL OR EXISTS (
          SELECT 1 FROM social.reel_comments child
           WHERE child.parent_comment_id = c.id AND child.deleted_at IS NULL
        ))
        ORDER BY c.created_at, c.id`,
      { replacements: { reelId }, type: QueryTypes.SELECT },
    );
  }

  async createComment(
    userId: string,
    reelId: string,
    body: string,
    parentCommentId?: string,
  ) {
    const normalizedBody = body.trim();
    if (normalizedBody.length === 0 || normalizedBody.length > 1000) {
      throw new BadRequestException(
        "El comentario debe tener entre 1 y 1000 caracteres.",
      );
    }
    return this.sequelize.transaction(async (transaction) => {
      const reel = await this.sequelize
        .query<{ userId: string; commentsEnabled: boolean }>(
          `SELECT r.user_id AS "userId", r.comments_enabled AS "commentsEnabled"
           FROM social.reels r
          WHERE r.id = :reelId AND r.status = 'READY'
            AND r.hidden_at IS NULL AND r.deleted_at IS NULL
            AND ${visibleAuthorPair("r.user_id", "CAST(:userId AS uuid)")}
          FOR UPDATE`,
          {
            replacements: { userId, reelId },
            type: QueryTypes.SELECT,
            transaction,
          },
        )
        .then((rows) => rows[0]);
      if (!reel) throw new NotFoundException("Reel no encontrado.");
      if (!reel.commentsEnabled)
        throw new ConflictException("Los comentarios están cerrados.");
      if (parentCommentId) {
        const [parent] = await this.sequelize.query<{ id: string }>(
          `SELECT id FROM social.reel_comments
            WHERE id = :parentCommentId AND reel_id = :reelId
              AND parent_comment_id IS NULL AND deleted_at IS NULL
            FOR UPDATE`,
          {
            replacements: { parentCommentId, reelId },
            type: QueryTypes.SELECT,
            transaction,
          },
        );
        if (!parent)
          throw new BadRequestException(
            "Solo se puede responder un comentario activo del reel.",
          );
      }
      const [comment] = await this.sequelize.query(
        `INSERT INTO social.reel_comments (reel_id, user_id, parent_comment_id, body)
         VALUES (:reelId, :userId, :parentCommentId, :body)
         RETURNING id, reel_id AS "reelId", parent_comment_id AS "parentCommentId",
                   user_id AS "userId", body, created_at AS "createdAt"`,
        {
          replacements: {
            reelId,
            userId,
            parentCommentId: parentCommentId ?? null,
            body: normalizedBody,
          },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      return comment;
    });
  }

  async deleteComment(userId: string, reelId: string, commentId: string) {
    const [deleted] = await this.sequelize.query<{ id: string }>(
      `UPDATE social.reel_comments c SET deleted_at = COALESCE(c.deleted_at, NOW())
        FROM social.reels r
       WHERE c.id = :commentId AND c.reel_id = :reelId AND r.id = c.reel_id
         AND c.deleted_at IS NULL
         AND (c.user_id = CAST(:userId AS uuid) OR r.user_id = CAST(:userId AS uuid))
       RETURNING c.id`,
      { replacements: { userId, reelId, commentId }, type: QueryTypes.SELECT },
    );
    if (!deleted) throw new NotFoundException("Comentario no encontrado.");
    return { deleted: true };
  }

  async setCommentsEnabled(userId: string, reelId: string, enabled: boolean) {
    const [updated] = await this.sequelize.query<{ commentsEnabled: boolean }>(
      `UPDATE social.reels SET comments_enabled = :enabled
        WHERE id = :reelId AND user_id = :userId AND deleted_at IS NULL
       RETURNING comments_enabled AS "commentsEnabled"`,
      { replacements: { userId, reelId, enabled }, type: QueryTypes.SELECT },
    );
    if (!updated) throw new NotFoundException("Reel no encontrado.");
    return { commentsEnabled: updated.commentsEnabled };
  }

  async deleteReel(userId: string, reelId: string) {
    const [deleted] = await this.sequelize.query<{ id: string }>(
      `UPDATE social.reels SET deleted_at = COALESCE(deleted_at, NOW())
        WHERE id = :reelId AND user_id = :userId AND deleted_at IS NULL
       RETURNING id`,
      { replacements: { userId, reelId }, type: QueryTypes.SELECT },
    );
    if (!deleted) throw new NotFoundException("Reel no encontrado.");
    return { deleted: true };
  }

  async canViewMedia(userId: string, reelId: string): Promise<boolean> {
    const [row] = await this.sequelize.query<{ allowed: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM social.reels r
          WHERE r.id = :reelId AND r.status = 'READY'
            AND r.hidden_at IS NULL AND r.deleted_at IS NULL
            AND ${visibleAuthorPair("r.user_id", "CAST(:userId AS uuid)")}
       ) AS allowed`,
      { replacements: { userId, reelId }, type: QueryTypes.SELECT },
    );
    return row?.allowed === true;
  }

  private async requireVisible(userId: string, reelId: string) {
    const [row] = await this.sequelize.query<{ userId: string }>(
      `SELECT r.user_id AS "userId" FROM social.reels r
        WHERE r.id = :reelId AND r.status = 'READY'
          AND r.hidden_at IS NULL AND r.deleted_at IS NULL
          AND ${visibleAuthorPair("r.user_id", "CAST(:userId AS uuid)")}`,
      { replacements: { userId, reelId }, type: QueryTypes.SELECT },
    );
    if (!row) throw new NotFoundException("Reel no encontrado.");
    return row;
  }
}

function visibleAuthorPair(
  authorExpression: string,
  viewerExpression: string,
): string {
  return `(
    ${authorExpression} = ${viewerExpression}
    OR (
      EXISTS (
        SELECT 1 FROM public.usuarios viewer
        JOIN public.usuarios author ON author.id = ${authorExpression}
        WHERE viewer.id = ${viewerExpression}
          AND viewer.estado = 'ACTIVO' AND author.estado = 'ACTIVO'
          AND (viewer.suspended_until IS NULL OR viewer.suspended_until <= NOW())
          AND (author.suspended_until IS NULL OR author.suspended_until <= NOW())
          AND NOT EXISTS (
            SELECT 1 FROM public.perfiles_antropometricos age
             WHERE age.usuario_id = author.id
               AND COALESCE(EXTRACT(YEAR FROM age(CURRENT_DATE, age.fecha_nacimiento))::int,
                            age.edad, 0) < 18
          )
      )
      AND (
        EXISTS (
          SELECT 1 FROM public.usuarios viewer
          JOIN public.usuarios author ON author.id = ${authorExpression}
          LEFT JOIN social.profile_settings settings ON settings.user_id = author.id
          WHERE viewer.id = ${viewerExpression}
            AND EXISTS (
              SELECT 1 FROM public.perfiles_antropometricos age
               WHERE age.usuario_id = author.id
                 AND COALESCE(EXTRACT(YEAR FROM age(CURRENT_DATE, age.fecha_nacimiento))::int,
                              age.edad, 0) >= 18
            )
            AND ((author.tenant_id = viewer.tenant_id AND COALESCE(settings.profile_enabled, false) = true)
              OR (author.tenant_id <> viewer.tenant_id
                AND COALESCE(settings.profile_enabled, false) = true
                AND COALESCE(settings.cross_gym_enabled, false) = true))
        )
        OR EXISTS (
          SELECT 1 FROM social.connections c
           WHERE c.status = 'ACCEPTED'
             AND ((c.requester_id = ${viewerExpression} AND c.addressee_id = ${authorExpression})
               OR (c.addressee_id = ${viewerExpression} AND c.requester_id = ${authorExpression}))
        )
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM social.user_blocks b
       WHERE (b.blocker_id = ${viewerExpression} AND b.blocked_id = ${authorExpression})
          OR (b.blocked_id = ${viewerExpression} AND b.blocker_id = ${authorExpression})
    )
  )`;
}

function mapRow(row: ReelRow) {
  return {
    id: row.id,
    userId: row.userId,
    mediaUrl: row.mediaUrl,
    durationSeconds: Number(row.durationSeconds),
    status: row.status,
    createdAt: new Date(row.createdAt).toISOString(),
    commentsEnabled: row.commentsEnabled,
    commentsCount: Number(row.commentsCount),
    likesCount: Number(row.likesCount),
    likedByMe: row.likedByMe,
    savedByMe: row.savedByMe,
    repostedByMe: row.repostedByMe,
    sharedBy: row.sharedBy ?? [],
  };
}

interface ReelFeedCursorState {
  activityAt: string;
  reelId: string;
}

function reelFeedCursorSignature(payload: string): string {
  return createHmac("sha256", env.JWT_ACCESS_SECRET)
    .update(payload)
    .digest("base64url");
}

function issueReelFeedCursor(
  state: ReelFeedCursorState,
  context: string,
): string {
  const encodedActivityAt = Buffer.from(state.activityAt).toString("base64url");
  const payload = `1.${context}.${encodedActivityAt}.${state.reelId}`;
  return `${payload}.${reelFeedCursorSignature(payload)}`;
}

function readReelFeedCursor(
  cursor: string,
  context: string,
): ReelFeedCursorState {
  try {
    const parts = cursor.split(".");
    if (
      parts.length !== 5 ||
      parts[0] !== "1" ||
      parts[1] !== context ||
      !/^[A-Za-z0-9_-]+$/u.test(parts[2]) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        parts[3],
      ) ||
      !/^[A-Za-z0-9_-]{43}$/u.test(parts[4])
    ) {
      throw new Error();
    }
    const payload = parts.slice(0, 4).join(".");
    const expected = Buffer.from(reelFeedCursorSignature(payload), "base64url");
    const supplied = Buffer.from(parts[4], "base64url");
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      throw new Error();
    }
    const activityAt = Buffer.from(parts[2], "base64url").toString("utf8");
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(activityAt) ||
      !Number.isFinite(Date.parse(activityAt))
    ) {
      throw new Error();
    }
    return { activityAt, reelId: parts[3] };
  } catch {
    throw new BadRequestException("Cursor de reels inválido o vencido.");
  }
}
