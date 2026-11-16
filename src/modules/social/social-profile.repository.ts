import { Injectable } from "@nestjs/common";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import type { SocialProfileDetailsRow } from "./social-profile.mapper";
import type { UpdateSocialProfileInput } from "./social-profile.schemas";

const RETURNED_COLUMNS = `orientation, orientation_visible AS "orientationVisible",
  interests, drinking, smoking, pets, bio, version`;

@Injectable()
export class SocialProfileRepository {
  constructor(private readonly sequelize: Sequelize) {}

  async find(userId: string): Promise<SocialProfileDetailsRow | null> {
    const rows = await this.sequelize.query<SocialProfileDetailsRow>(
      `SELECT ${RETURNED_COLUMNS} FROM social.profile_details WHERE user_id = :userId`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return rows[0] ?? null;
  }

  /**
   * Optimistic write: version 0 creates the row, any other version must match
   * the stored one. `null` means the caller's copy is stale.
   */
  async save(
    userId: string,
    input: UpdateSocialProfileInput,
  ): Promise<SocialProfileDetailsRow | null> {
    const replacements = {
      userId,
      orientation: input.orientation,
      orientationVisible: input.orientationVisible,
      interestsJson: JSON.stringify(input.interests),
      drinking: input.drinking,
      smoking: input.smoking,
      pets: input.pets,
      bio: input.bio,
      expectedVersion: input.expectedVersion,
    };
    const interests = `ARRAY(SELECT jsonb_array_elements_text(CAST(:interestsJson AS jsonb)))`;
    const statement =
      input.expectedVersion === 0
        ? `INSERT INTO social.profile_details
             (user_id, orientation, orientation_visible, interests, drinking, smoking, pets, bio, version)
           VALUES (:userId, :orientation, :orientationVisible, ${interests}, :drinking, :smoking, :pets, :bio, 1)
           ON CONFLICT (user_id) DO NOTHING
           RETURNING ${RETURNED_COLUMNS}`
        : `UPDATE social.profile_details
              SET orientation = :orientation, orientation_visible = :orientationVisible,
                  interests = ${interests}, drinking = :drinking, smoking = :smoking,
                  pets = :pets, bio = :bio, version = version + 1, updated_at = NOW()
            WHERE user_id = :userId AND version = :expectedVersion
           RETURNING ${RETURNED_COLUMNS}`;
    const rows = await this.sequelize.query<SocialProfileDetailsRow>(statement, {
      type: QueryTypes.SELECT,
      replacements,
    });
    return rows[0] ?? null;
  }

  /** Photos other members can actually see (moderation-hidden ones do not count). */
  async countVisiblePhotos(userId: string): Promise<number> {
    const rows = await this.sequelize.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM profile.photos
        WHERE user_id = :userId AND hidden_at IS NULL`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return rows[0]?.total ?? 0;
  }
}
