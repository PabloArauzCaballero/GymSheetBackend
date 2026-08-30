import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { QueryTypes } from "sequelize";
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

  async delete(story: StoryModel): Promise<void> {
    await story.destroy();
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
