import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ProfileViewModel } from "./profile-view.model";

@Injectable()
export class ProfileViewsRepository {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(ProfileViewModel) private readonly views: typeof ProfileViewModel,
  ) {}

  record(viewerId: string, viewedUserId: string, tenantId: string): Promise<ProfileViewModel> {
    return this.views.create({ viewerId, viewedUserId, tenantId });
  }

  /** Visitantes únicos de hoy (zona horaria del negocio), no cantidad total de vistas. */
  async countUniqueTodayFor(viewedUserId: string): Promise<number> {
    const rows = await this.sequelize.query<{ count: string }>(
      `SELECT COUNT(DISTINCT viewer_id) AS count
         FROM profile.profile_views
        WHERE viewed_user_id = :viewedUserId
          AND viewed_at >= date_trunc('day', now())`,
      { type: QueryTypes.SELECT, replacements: { viewedUserId } },
    );
    return Number(rows[0]?.count ?? 0);
  }
}
