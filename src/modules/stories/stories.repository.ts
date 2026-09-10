import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import type { StoredAsset } from "../media/media-storage.port";
import { StoryModel, StoryMediaType } from "./story.model";
import { StoryViewModel } from "./story-view.model";

export interface StoryFeedRow {
  id: string;
  user_id: string;
  full_name: string;
  photo_url: string | null;
  media_url: string;
  media_type: StoryMediaType;
  created_at: string;
  expires_at: string;
  viewed_by_me: boolean;
}

/**
 * Referencia mínima de una story caducada: lo justo para borrarla y decidir
 * sobre su binario. Deliberadamente NO es un modelo de Sequelize — la purga no
 * necesita la fila entera y los modelos ORM no salen del repositorio.
 */
export interface ExpiredStoryReference {
  readonly id: string;
  readonly storageKey: string;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class StoriesRepository {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(StoryModel) private readonly stories: typeof StoryModel,
    @InjectModel(StoryViewModel) private readonly views: typeof StoryViewModel,
  ) {}

  async create(
    userId: string,
    tenantId: string,
    asset: StoredAsset,
    mediaType: StoryMediaType,
  ): Promise<StoryModel> {
    return this.stories.create({
      userId,
      tenantId,
      mediaUrl: asset.url,
      storageProvider: asset.provider,
      storageKey: asset.key,
      mediaType,
      expiresAt: new Date(Date.now() + ONE_DAY_MS),
    });
  }

  findByIdForUser(id: string, userId: string): Promise<StoryModel | null> {
    return this.stories.findOne({ where: { id, userId } });
  }

  findById(id: string): Promise<StoryModel | null> {
    return this.stories.findByPk(id);
  }

  async delete(story: StoryModel, transaction?: Transaction): Promise<void> {
    await story.destroy({ transaction });
  }

  /**
   * Stories ya caducadas, de la más antigua a la más nueva, acotadas por lote.
   * El índice `ix_profile_stories_feed (tenant_id, expires_at)` no sirve aquí
   * (no filtramos por tenant), pero la tabla se mantiene pequeña justamente
   * porque esta purga corre.
   */
  async findExpired(
    now: Date,
    limit: number,
  ): Promise<ExpiredStoryReference[]> {
    return this.sequelize.query<ExpiredStoryReference>(
      `SELECT id, storage_key AS "storageKey"
         FROM profile.stories
        WHERE expires_at <= :now
        ORDER BY expires_at ASC
        LIMIT :limit`,
      { type: QueryTypes.SELECT, replacements: { now, limit } },
    );
  }

  /**
   * Borrado por id, idempotente: devuelve cuántas filas cayeron, de modo que
   * dos purgas simultáneas sobre la misma story no se estorban.
   */
  async deleteById(id: string, transaction?: Transaction): Promise<number> {
    return this.stories.destroy({ where: { id }, transaction });
  }

  /**
   * Stories activas del tenant (incluidas las propias), con si ya las vio
   * quien pregunta. Un LEFT JOIN, no N consultas: el feed puede tener
   * decenas de socios con story activa.
   */
  async feedForTenant(viewerId: string, tenantId: string): Promise<StoryFeedRow[]> {
    return this.sequelize.query<StoryFeedRow>(
      `SELECT s.id,
              s.user_id,
              u.nombre_completo AS full_name,
              photo.url AS photo_url,
              s.media_url,
              s.media_type,
              s.created_at,
              s.expires_at,
              (v.viewer_id IS NOT NULL) AS viewed_by_me
         FROM profile.stories s
         JOIN public.usuarios u ON u.id = s.user_id
         LEFT JOIN LATERAL (
           SELECT url FROM profile.photos p
            WHERE p.user_id = s.user_id
            ORDER BY p.position ASC LIMIT 1
         ) photo ON true
         LEFT JOIN profile.story_views v ON v.story_id = s.id AND v.viewer_id = :viewerId
        WHERE s.tenant_id = :tenantId
          AND s.expires_at > now()
        ORDER BY s.user_id, s.created_at ASC`,
      { type: QueryTypes.SELECT, replacements: { viewerId, tenantId } },
    );
  }

  /** Idempotente: ver la misma story dos veces no falla ni duplica. */
  async recordView(storyId: string, viewerId: string): Promise<void> {
    await this.views.findOrCreate({
      where: { storyId, viewerId },
      defaults: { storyId, viewerId, viewedAt: new Date() },
    });
  }
}
